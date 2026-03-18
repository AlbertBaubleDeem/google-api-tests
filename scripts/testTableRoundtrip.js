import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Test table insert/read with Google Docs API to confirm:
 * - InsertTableRequest (rows, columns, endOfSegmentLocation + tabId)
 * - Re-fetch to get table structure and cell indices
 * - insertText into cell paragraph indices
 *
 * Usage: npm run testTableRoundtrip -- <documentId> <tabId>
 */

const [documentId, tabId] = process.argv.slice(2);
if (!documentId || !tabId) {
	console.error('Usage: npm run testTableRoundtrip -- <documentId> <tabId>');
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

/**
 * Get tab body content and end index for insertion
 */
async function getTabBody() {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const tab = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId);
	const body = tab?.documentTab?.body;
	const content = body?.content || [];
	const last = content[content.length - 1];
	const endIndex = last?.endIndex ?? 1;
	return { content, endIndex, tabId };
}

/**
 * Insert an empty table at end of tab body.
 * Returns the batchUpdate response (no insertTable reply in API).
 */
async function insertTable(rows, columns) {
	const { endIndex } = await getTabBody();
	// Insert at end of segment (body). segmentId '' = body.
	const requests = [{
		insertTable: {
			rows,
			columns,
			endOfSegmentLocation: { segmentId: '', tabId },
		},
	}];
	const res = await docs.documents.batchUpdate({
		documentId,
		requestBody: { requests },
	});
	console.log('InsertTable batchUpdate reply:', JSON.stringify(res.data.replies, null, 2));
	return res.data;
}

/**
 * Walk body.content and find the table element; extract cell text and indices.
 */
function findTableAndCellIndices(content) {
	for (let i = 0; i < content.length; i++) {
		const el = content[i];
		if (!el.table) continue;
		const table = el.table;
		const startIndex = el.startIndex;
		const endIndex = el.endIndex;
		const rows = (table.tableRows || []).map((row, rowIdx) => {
			const cells = (row.tableCells || []).map((cell, colIdx) => {
				// cell.content[] are StructuralElements; startIndex/endIndex are on the element, not on .paragraph
				const firstContent = cell.content?.[0];
				const firstPara = firstContent?.paragraph;
				const paraEls = firstPara?.elements || [];
				const text = paraEls
					.map(e => e.textRun?.content || '')
					.join('')
					.replace(/\n$/, '');
				// startIndex/endIndex live on the StructuralElement (firstContent), not on the Paragraph.
				// Fallback: TableCell itself has startIndex/endIndex if nested content omits them.
				const paraStart = firstContent?.startIndex ?? cell.startIndex;
				const paraEnd = firstContent?.endIndex ?? cell.endIndex;
				return {
					rowIdx,
					colIdx,
					text,
					startIndex: paraStart,
					endIndex: paraEnd,
				};
			});
			return cells;
		});
		return {
			contentIndex: i,
			startIndex,
			endIndex,
			rows,
			columns: table.columns,
		};
	}
	return null;
}

/**
 * Insert text at a given index (1-based) in the document.
 */
async function insertTextAt(index, text) {
	const requests = [{
		insertText: {
			location: { index, tabId },
			text,
		},
	}];
	await docs.documents.batchUpdate({
		documentId,
		requestBody: { requests },
	});
}

async function main() {
	console.log('=== Table API roundtrip test ===\n');
	console.log('Document:', documentId, 'Tab:', tabId);

	// 1) Insert a 2x2 table
	console.log('\n1. Inserting 2x2 table at end of tab...');
	await insertTable(2, 2);

	// 2) Re-fetch and find table + cell indices
	console.log('\n2. Re-fetching document to get table structure...');
	const { content } = await getTabBody();
	const table = findTableAndCellIndices(content);
	if (!table) {
		console.error('No table found in content.');
		process.exit(1);
	}
	console.log('Table found:', {
		contentIndex: table.contentIndex,
		startIndex: table.startIndex,
		endIndex: table.endIndex,
		columns: table.columns,
		rows: table.rows.length,
	});
	console.log('Cell indices (for insertText):');
	for (const row of table.rows) {
		for (const cell of row) {
			// insertText must be inside paragraph bounds; use startIndex (beginning of paragraph)
			const insertAt = cell.startIndex != null ? cell.startIndex : null;
			console.log(`  [${cell.rowIdx},${cell.colIdx}] text="${cell.text}" startIndex=${cell.startIndex} endIndex=${cell.endIndex} -> insertAt=${insertAt}`);
		}
	}

	// 3) Insert text into cells (reverse order by index so earlier inserts don't shift later indices)
	const cellsToFill = [];
	for (const row of table.rows) {
		for (const cell of row) {
			if (cell.startIndex != null) cellsToFill.push({ ...cell, text: '' });
		}
	}
	cellsToFill[0].text = 'A1';
	if (cellsToFill.length > 1) cellsToFill[1].text = 'B1';
	cellsToFill.sort((a, b) => (b.startIndex - a.startIndex));
	console.log('\n3. Inserting text into cells [0,0] and [0,1]...');
	for (const c of cellsToFill) {
		if (!c.text) continue;
		await insertTextAt(c.startIndex, c.text);
	}

	// 4) Re-fetch and print table again
	console.log('\n4. Re-fetching to verify cell content...');
	const { content: content2 } = await getTabBody();
	const table2 = findTableAndCellIndices(content2);
	if (table2) {
		console.log('Cell contents after insertText:');
		for (const row of table2.rows) {
			for (const cell of row) {
				console.log(`  [${cell.rowIdx},${cell.colIdx}] "${cell.text}"`);
			}
		}
	}

	console.log('\nDone.');
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
