import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Comprehensive table API edge-case tests.
 *
 * Covers: 1x1, 1xN, Nx1, 2x2, 3x4; all cells vs partial fill; special chars;
 * long text; multiple tables; table after existing content.
 *
 * Usage: npm run testTableEdgeCases -- <documentId> <tabId>
 */

const [documentId, tabId] = process.argv.slice(2);
if (!documentId || !tabId) {
	console.error('Usage: npm run testTableEdgeCases -- <documentId> <tabId>');
	process.exit(1);
}

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));
const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET
);
auth.setCredentials(tokens);
const docs = google.docs({ version: 'v1', auth });

async function getTabBody() {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const tab = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId);
	const body = tab?.documentTab?.body;
	const content = body?.content || [];
	const last = content[content.length - 1];
	const endIndex = last?.endIndex ?? 1;
	return { content, endIndex, tabId };
}

async function clearTabBody() {
	const { content, endIndex } = await getTabBody();
	if (endIndex <= 2) return;
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				deleteContentRange: {
					range: { tabId, startIndex: 1, endIndex: endIndex - 1 },
				},
			}],
		},
	});
}

async function insertTable(rows, columns) {
	const { endIndex } = await getTabBody();
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				insertTable: {
					rows,
					columns,
					endOfSegmentLocation: { segmentId: '', tabId },
				},
			}],
		},
	});
}

async function insertTextAt(index, text) {
	if (text === '') return;
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				insertText: {
					location: { index, tabId },
					text,
				},
			}],
		},
	});
}

async function insertParagraphAtEnd(text) {
	const { endIndex } = await getTabBody();
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				insertText: {
					location: { index: endIndex - 1, tabId },
					text: text + '\n',
				},
			}],
		},
	});
}

function getCellIndices(cell) {
	const firstContent = cell.content?.[0];
	return {
		startIndex: firstContent?.startIndex ?? cell.startIndex,
		endIndex: firstContent?.endIndex ?? cell.endIndex,
	};
}

function getCellText(cell) {
	const content = cell.content || [];
	const parts = [];
	for (const se of content) {
		const para = se?.paragraph;
		if (!para?.elements) continue;
		const text = para.elements
			.map(e => e.textRun?.content || '')
			.join('')
			.replace(/\n$/, '');
		parts.push(text);
	}
	return parts.join('\n');
}

/**
 * Find all tables in body content; return array of { contentIndex, startIndex, endIndex, rows, columns }.
 * rows: for each row, array of { rowIdx, colIdx, text, startIndex, endIndex }.
 */
function findAllTables(content) {
	const tables = [];
	for (let i = 0; i < content.length; i++) {
		const el = content[i];
		if (!el.table) continue;
		const table = el.table;
		const rows = (table.tableRows || []).map((row, rowIdx) => {
			return (row.tableCells || []).map((cell, colIdx) => {
				const { startIndex, endIndex } = getCellIndices(cell);
				return {
					rowIdx,
					colIdx,
					text: getCellText(cell),
					startIndex,
					endIndex,
				};
			});
		});
		tables.push({
			contentIndex: i,
			startIndex: el.startIndex,
			endIndex: el.endIndex,
			rows,
			columns: table.columns,
		});
	}
	return tables;
}

/** Fill cells with text in reverse index order. cellTexts: 2D array row-major [row][col]. */
async function fillTableCells(table, cellTexts) {
	const cells = [];
	for (let r = 0; r < table.rows.length; r++) {
		for (let c = 0; c < table.rows[r].length; c++) {
			const cell = table.rows[r][c];
			const text = cellTexts[r]?.[c] ?? '';
			if (cell.startIndex != null) {
				cells.push({ ...cell, text });
			}
		}
	}
	cells.sort((a, b) => (b.startIndex - a.startIndex));
	for (const cell of cells) {
		await insertTextAt(cell.startIndex, cell.text);
	}
}

function tableTo2DText(table) {
	return table.rows.map(row => row.map(c => c.text));
}

function assertEqual(actual, expected, msg) {
	const s = (v) => JSON.stringify(v);
	if (actual !== expected) {
		throw new Error(`${msg}: expected ${s(expected)}, got ${s(actual)}`);
	}
}

function assertDeepEqual(actual, expected, msg) {
	const s = (v) => JSON.stringify(v);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${msg}:\nexpected ${s(expected)}\ngot ${s(actual)}`);
	}
}

let passed = 0;
let failed = 0;

function log(name, ...args) {
	console.log(`  [${name}]`, ...args);
}

async function runTest(name, fn) {
	try {
		await fn();
		log(name, 'PASS');
		passed++;
		return true;
	} catch (e) {
		log(name, 'FAIL:', e.message);
		failed++;
		return false;
	}
}

async function main() {
	console.log('=== Table API edge-case tests ===\n');
	console.log('Document:', documentId, 'Tab:', tabId);

	// Ensure clean tab
	await clearTabBody();

	// --- 1x1 table ---
	await runTest('1x1 table', async () => {
		await insertTable(1, 1);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		assertEqual(tables.length, 1, 'one table');
		assertEqual(tables[0].rows.length, 1, 'one row');
		assertEqual(tables[0].rows[0].length, 1, 'one cell');
		await fillTableCells(tables[0], [['X']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertEqual(t2.rows[0][0].text, 'X', 'cell text');
	});

	await clearTabBody();

	// --- 1x3 table (one row, three columns) ---
	await runTest('1x3 table', async () => {
		await insertTable(1, 3);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		assertEqual(tables.length, 1, 'one table');
		assertEqual(tables[0].rows[0].length, 3, 'three cells');
		await fillTableCells(tables[0], [['A', 'B', 'C']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertDeepEqual(tableTo2DText(t2), [['A', 'B', 'C']], 'cell texts');
	});

	await clearTabBody();

	// --- 3x1 table (three rows, one column) ---
	await runTest('3x1 table', async () => {
		await insertTable(3, 1);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		assertEqual(tables[0].rows.length, 3, 'three rows');
		await fillTableCells(tables[0], [['1'], ['2'], ['3']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertDeepEqual(tableTo2DText(t2), [['1'], ['2'], ['3']], 'cell texts');
	});

	await clearTabBody();

	// --- 2x2 all cells ---
	await runTest('2x2 all cells', async () => {
		await insertTable(2, 2);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		await fillTableCells(tables[0], [['A1', 'B1'], ['A2', 'B2']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertDeepEqual(tableTo2DText(t2), [['A1', 'B1'], ['A2', 'B2']], 'cell texts');
	});

	await clearTabBody();

	// --- 3x4 partial fill (row 0 and row 2 only) ---
	await runTest('3x4 partial fill', async () => {
		await insertTable(3, 4);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		await fillTableCells(tables[0], [
			['R0C0', 'R0C1', 'R0C2', 'R0C3'],
			['', '', '', ''],
			['R2C0', 'R2C1', 'R2C2', 'R2C3'],
		]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertEqual(t2.rows[0][0].text, 'R0C0', 'row0');
		assertEqual(t2.rows[0][3].text, 'R0C3', 'row0 last');
		assertEqual(t2.rows[1][0].text, '', 'row1 empty');
		assertEqual(t2.rows[2][0].text, 'R2C0', 'row2');
		assertEqual(t2.rows[2][3].text, 'R2C3', 'row2 last');
	});

	await clearTabBody();

	// --- Special characters: pipe, unicode ---
	await runTest('Special chars (pipe, unicode)', async () => {
		await insertTable(1, 2);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		await fillTableCells(tables[0], [['a|b', 'café']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertEqual(t2.rows[0][0].text, 'a|b', 'pipe');
		assertEqual(t2.rows[0][1].text, 'café', 'unicode');
	});

	await clearTabBody();

	// --- Long text in one cell ---
	await runTest('Long text in cell', async () => {
		await insertTable(1, 1);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		const long = 'x'.repeat(500);
		await fillTableCells(tables[0], [[long]]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertEqual(t2.rows[0][0].text.length, 500, 'length');
		assertEqual(t2.rows[0][0].text, long, 'content');
	});

	await clearTabBody();

	// --- Multiple tables: two tables, fill both (reverse index order so second table first) ---
	await runTest('Multiple tables', async () => {
		await insertTable(1, 1);
		await insertTable(1, 1);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		assertEqual(tables.length, 2, 'two tables');
		// Fill in reverse index order: second table then first, so indices don't shift
		const allCells = [];
		tables[0].rows.forEach((row, r) => row.forEach((cell, c) => {
			allCells.push({ ...cell, text: r === 0 && c === 0 ? 'First' : '' });
		}));
		tables[1].rows.forEach((row, r) => row.forEach((cell, c) => {
			allCells.push({ ...cell, text: r === 0 && c === 0 ? 'Second' : '' });
		}));
		allCells.sort((a, b) => (b.startIndex - a.startIndex));
		for (const cell of allCells) {
			await insertTextAt(cell.startIndex, cell.text);
		}
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2);
		assertEqual(t2[0].rows[0][0].text, 'First', 'first table');
		assertEqual(t2[1].rows[0][0].text, 'Second', 'second table');
	});

	await clearTabBody();

	// --- Table after existing paragraph ---
	await runTest('Table after existing content', async () => {
		await insertParagraphAtEnd('Intro text');
		await insertTable(2, 2);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		assertEqual(tables.length, 1, 'one table');
		await fillTableCells(tables[0], [['T1', 'T2'], ['T3', 'T4']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		assertDeepEqual(tableTo2DText(t2), [['T1', 'T2'], ['T3', 'T4']], 'cell texts');
	});

	await clearTabBody();

	// --- Newline in cell (API may store as vertical tab or newline) ---
	await runTest('Newline in cell', async () => {
		await insertTable(1, 1);
		const { content } = await getTabBody();
		const tables = findAllTables(content);
		await fillTableCells(tables[0], [['line1\nline2']]);
		const { content: c2 } = await getTabBody();
		const t2 = findAllTables(c2)[0];
		const text = t2.rows[0][0].text;
		if (!text.includes('line1') || !text.includes('line2')) {
			throw new Error('Expected line1 and line2 in cell, got: ' + JSON.stringify(text));
		}
	});

	console.log('\n--- Summary ---');
	console.log('Passed:', passed, 'Failed:', failed);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
