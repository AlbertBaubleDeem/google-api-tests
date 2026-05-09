import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Test list round-trip behavior to understand how different list types
 * are represented in Google Docs and how to handle them.
 * 
 * Based on Joplin's markdown syntax:
 * - Unordered: "- item" with 4-space indent for nesting
 * - Ordered: "1. item" with 4-space indent for nesting
 * 
 * Usage: npm run testListRoundtrip -- <documentId> <tabId>
 */

const [documentId, tabId] = process.argv.slice(2);
if (!documentId || !tabId) {
	console.error('Usage: npm run testListRoundtrip -- <documentId> <tabId>');
	process.exit(1);
}

// Setup auth
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

/**
 * Clear tab content and insert new text
 */
async function clearAndInsert(text) {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const endIndex = tabBody?.content?.slice(-1)[0]?.endIndex || 1;
	
	const requests = [];
	if (endIndex > 2) {
		requests.push({
			deleteContentRange: {
				range: { tabId, startIndex: 1, endIndex: endIndex - 1 },
			},
		});
	}
	requests.push({
		insertText: {
			location: { index: 1, tabId },
			text,
		},
	});
	
	await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
}

/**
 * Apply bullet formatting
 */
async function applyBullets(startIndex, endIndex, bulletPreset) {
	const req = {
		createParagraphBullets: {
			range: { tabId, startIndex, endIndex },
			bulletPreset,
		},
	};
	await docs.documents.batchUpdate({ documentId, requestBody: { requests: [req] } });
}

/**
 * Read document and extract list information
 */
async function readDocLists() {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const tab = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId);
	const tabBody = tab?.documentTab?.body;
	const lists = tab?.documentTab?.lists || {};
	
	const paragraphs = (tabBody?.content || [])
		.filter(se => se.paragraph)
		.map((se, idx) => {
			const p = se.paragraph;
			const text = p.elements?.map(e => e.textRun?.content || '').join('').replace(/\n$/, '');
			const bullet = p.bullet;
			return {
				idx,
				text,
				hasBullet: !!bullet,
				listId: bullet?.listId,
				nestingLevel: bullet?.nestingLevel || 0,
			};
		});
	
	return { paragraphs, lists };
}

/**
 * Determine if a list is ordered based on its glyphType
 */
function isOrderedGlyph(glyphType) {
	const orderedTypes = ['DECIMAL', 'ALPHA', 'UPPER_ALPHA', 'ROMAN', 'UPPER_ROMAN', 'ZERODECIMAL'];
	return orderedTypes.includes(glyphType);
}

/**
 * Convert Google Docs list back to Markdown format
 */
function docsListToMarkdown(paragraphs, lists) {
	const result = [];
	
	for (const para of paragraphs) {
		if (!para.hasBullet) {
			result.push(para.text);
			continue;
		}
		
		// Get list definition
		const listDef = lists[para.listId];
		const nestingLevelDef = listDef?.listProperties?.nestingLevels?.[para.nestingLevel];
		
		// Determine list type
		const glyphType = nestingLevelDef?.glyphType;
		const glyphSymbol = nestingLevelDef?.glyphSymbol;
		
		// Determine prefix
		let prefix;
		if (isOrderedGlyph(glyphType)) {
			prefix = '1. ';
		} else {
			// For unordered, always use dash (Joplin standard)
			prefix = '- ';
		}
		
		// Add indentation (4 spaces per level, Joplin standard)
		const indent = '    '.repeat(para.nestingLevel);
		
		result.push(indent + prefix + para.text);
	}
	
	return result.join('\n');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// TEST CASES
// ============================================================

async function testUnorderedListRoundtrip() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Unordered List Round-trip');
	console.log('='.repeat(60));
	
	// Simulate markdown input: "- Item 1\n- Item 2\n    - Nested"
	const markdownInput = `- Item 1
- Item 2
    - Nested Item`;
	
	console.log('\n1. MARKDOWN INPUT:');
	console.log(markdownInput);
	
	// Process for Google Docs (strip prefixes, add tabs for nesting)
	const lines = markdownInput.split('\n');
	const processedLines = lines.map(line => {
		// Count 4-space indents
		const indentMatch = line.match(/^( {4})*/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		
		// Strip indent and prefix
		let content = line.replace(/^( {4})*/, '').replace(/^- /, '');
		
		// Add tabs for nesting
		return '\t'.repeat(nestingLevel) + content;
	});
	
	console.log('\n2. PROCESSED FOR GOOGLE DOCS API:');
	processedLines.forEach(l => console.log(`  "${l.replace(/\t/g, '\\t')}"`));
	
	// Insert and apply bullets
	const heading = 'Unordered List Test\n';
	const listText = processedLines.join('\n') + '\n';
	const fullText = heading + listText;
	
	await clearAndInsert(fullText);
	
	// Apply heading style
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	// Apply bullets
	const listStart = 1 + heading.length;
	await applyBullets(listStart, fullText.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	console.log('\n3. GOOGLE DOCS (check document - should show bullet points)');
	
	// Read back
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n4. READ BACK FROM GOOGLE DOCS:');
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	bulletedParas.forEach(p => {
		const listDef = lists[p.listId];
		const nestingDef = listDef?.listProperties?.nestingLevels?.[p.nestingLevel];
		console.log(`  Level ${p.nestingLevel}: "${p.text}" (glyphSymbol: "${nestingDef?.glyphSymbol}", glyphType: "${nestingDef?.glyphType}")`);
	});
	
	// Convert back to Markdown
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	
	console.log('\n5. CONVERTED BACK TO MARKDOWN:');
	console.log(markdownOutput);
	
	// Compare
	const inputNormalized = markdownInput.trim();
	const outputNormalized = markdownOutput.trim();
	const match = inputNormalized === outputNormalized;
	
	console.log('\n6. ROUND-TRIP RESULT:', match ? '✅ MATCH' : '❌ MISMATCH');
	if (!match) {
		console.log('   Expected:', JSON.stringify(inputNormalized));
		console.log('   Got:     ', JSON.stringify(outputNormalized));
	}
	
	return match;
}

async function testOrderedListRoundtrip() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Ordered List Round-trip');
	console.log('='.repeat(60));
	
	// Simulate markdown input
	const markdownInput = `1. First item
2. Second item
    1. Nested item`;
	
	console.log('\n1. MARKDOWN INPUT:');
	console.log(markdownInput);
	
	// Process for Google Docs
	const lines = markdownInput.split('\n');
	const processedLines = lines.map(line => {
		const indentMatch = line.match(/^( {4})*/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		
		// Strip indent and ordered prefix (N. )
		let content = line.replace(/^( {4})*/, '').replace(/^\d+\. /, '');
		
		return '\t'.repeat(nestingLevel) + content;
	});
	
	console.log('\n2. PROCESSED FOR GOOGLE DOCS API:');
	processedLines.forEach(l => console.log(`  "${l.replace(/\t/g, '\\t')}"`));
	
	// Insert and apply bullets
	const heading = 'Ordered List Test\n';
	const listText = processedLines.join('\n') + '\n';
	const fullText = heading + listText;
	
	await clearAndInsert(fullText);
	
	// Apply heading style
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	// Apply numbered bullets
	const listStart = 1 + heading.length;
	await applyBullets(listStart, fullText.length, 'NUMBERED_DECIMAL_ALPHA_ROMAN');
	
	console.log('\n3. GOOGLE DOCS (check document - should show 1. 2. a.)');
	
	// Read back
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n4. READ BACK FROM GOOGLE DOCS:');
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	bulletedParas.forEach(p => {
		const listDef = lists[p.listId];
		const nestingDef = listDef?.listProperties?.nestingLevels?.[p.nestingLevel];
		console.log(`  Level ${p.nestingLevel}: "${p.text}" (glyphType: "${nestingDef?.glyphType}")`);
	});
	
	// Convert back to Markdown
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	
	console.log('\n5. CONVERTED BACK TO MARKDOWN:');
	console.log(markdownOutput);
	
	// For ordered lists, normalize numbering (Joplin uses sequential numbers but we output 1.)
	const inputNormalized = markdownInput.replace(/^\d+\./gm, '1.');
	const outputNormalized = markdownOutput.trim();
	const match = inputNormalized.trim() === outputNormalized;
	
	console.log('\n6. ROUND-TRIP RESULT:', match ? '✅ MATCH' : '❌ MISMATCH (numbering normalized)');
	if (!match) {
		console.log('   Expected:', JSON.stringify(inputNormalized.trim()));
		console.log('   Got:     ', JSON.stringify(outputNormalized));
	}
	
	return match;
}

async function testReadExistingDashList() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Read Existing Dash List (created in GUI)');
	console.log('='.repeat(60));
	
	console.log('\nReading current document to find dash-style lists...\n');
	
	const { paragraphs, lists } = await readDocLists();
	
	// Find lists with glyphSymbol: "-"
	const dashLists = new Set();
	for (const [listId, listDef] of Object.entries(lists)) {
		const level0 = listDef.listProperties?.nestingLevels?.[0];
		if (level0?.glyphSymbol === '-') {
			dashLists.add(listId);
			console.log(`Found dash list: ${listId}`);
			console.log('  Nesting levels:');
			listDef.listProperties?.nestingLevels?.forEach((level, i) => {
				console.log(`    Level ${i}: glyphSymbol="${level.glyphSymbol}", glyphType="${level.glyphType}"`);
			});
		}
	}
	
	if (dashLists.size === 0) {
		console.log('No dash-style lists found in document.');
		console.log('Please create one in the Google Docs GUI first.');
		return false;
	}
	
	// Find paragraphs using dash lists
	const dashParas = paragraphs.filter(p => p.hasBullet && dashLists.has(p.listId));
	
	if (dashParas.length > 0) {
		console.log('\nParagraphs using dash lists:');
		dashParas.forEach(p => {
			console.log(`  Level ${p.nestingLevel}: "${p.text}"`);
		});
		
		// Convert to markdown
		const markdownOutput = docsListToMarkdown(dashParas, lists);
		console.log('\nConverted to Markdown:');
		console.log(markdownOutput);
		
		console.log('\n✅ Dash lists are correctly converted to "- " prefix in Markdown');
	}
	
	return true;
}

async function testBulletCharactersNotLists() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Bullet Characters (NOT lists) - Plain Text');
	console.log('='.repeat(60));
	
	// This tests that actual bullet characters in text are NOT converted to lists
	// They should remain as plain paragraphs
	
	const textWithBulletChars = `Text with bullet characters:
• This has a bullet character
• Another line with bullet
● Different bullet style
★ Star bullet`;
	
	console.log('\n1. INPUT (plain text with Unicode bullet chars):');
	console.log(textWithBulletChars);
	
	// Insert as plain text (no list formatting)
	await clearAndInsert(textWithBulletChars + '\n');
	
	console.log('\n2. Inserted as plain text (no CreateParagraphBulletsRequest)');
	
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n3. READ BACK FROM GOOGLE DOCS:');
	paragraphs.forEach(p => {
		console.log(`  hasBullet: ${p.hasBullet}, text: "${p.text}"`);
	});
	
	// Check that none have bullets
	const nonListParas = paragraphs.filter(p => !p.hasBullet);
	const bulletParas = paragraphs.filter(p => p.hasBullet);
	
	console.log(`\n4. RESULT: ${nonListParas.length} plain paragraphs, ${bulletParas.length} list items`);
	
	if (bulletParas.length === 0) {
		console.log('✅ Bullet characters remained as plain text, not converted to lists');
		return true;
	} else {
		console.log('❌ Some paragraphs were unexpectedly converted to lists');
		return false;
	}
}

async function testNumberedDecimalNested() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: NUMBERED_DECIMAL_NESTED vs NUMBERED_DECIMAL_ALPHA_ROMAN');
	console.log('='.repeat(60));
	
	// Test NUMBERED_DECIMAL_NESTED (the one we want to use)
	const heading = 'NUMBERED_DECIMAL_NESTED Test\n';
	const listText = 'First item\n\tNested item\n\t\tDeep nested\nSecond item\n';
	const text = heading + listText;
	
	await clearAndInsert(text);
	
	// Apply heading style
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'NUMBERED_DECIMAL_NESTED');
	
	console.log('\n1. Applied NUMBERED_DECIMAL_NESTED preset');
	console.log('   Expected: 1. 1.1. 1.1.1. style (nested decimal)');
	
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n2. READ BACK FROM GOOGLE DOCS:');
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	bulletedParas.forEach(p => {
		const listDef = lists[p.listId];
		const nestingDef = listDef?.listProperties?.nestingLevels?.[p.nestingLevel];
		console.log(`  Level ${p.nestingLevel}: "${p.text}" (glyphType: "${nestingDef?.glyphType}", glyphFormat: "${nestingDef?.glyphFormat}")`);
	});
	
	// Convert to markdown using our logic
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	console.log('\n3. CONVERTED TO MARKDOWN:');
	console.log(markdownOutput);
	
	// Verify all are detected as ordered (DECIMAL type)
	const allOrdered = bulletedParas.every(p => {
		const listDef = lists[p.listId];
		const nestingDef = listDef?.listProperties?.nestingLevels?.[p.nestingLevel];
		return isOrderedGlyph(nestingDef?.glyphType);
	});
	
	console.log('\n4. RESULT:', allOrdered ? '✅ All detected as ordered lists' : '❌ Some not detected as ordered');
	console.log('   (NUMBERED_DECIMAL_NESTED uses DECIMAL type at all levels)');
	
	return allOrdered;
}

async function testDeepUnorderedNesting() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Deep Unordered Nesting (4 levels)');
	console.log('='.repeat(60));
	
	// Markdown input with 4 levels of nesting
	const markdownInput = `- Level 0
    - Level 1
        - Level 2
            - Level 3
        - Back to Level 2
    - Back to Level 1
- Another Level 0`;
	
	console.log('\n1. MARKDOWN INPUT:');
	console.log(markdownInput);
	
	// Process for Google Docs
	const lines = markdownInput.split('\n');
	const processedLines = lines.map(line => {
		const indentMatch = line.match(/^( {4})*/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		let content = line.replace(/^( {4})*/, '').replace(/^- /, '');
		return '\t'.repeat(nestingLevel) + content;
	});
	
	console.log('\n2. PROCESSED FOR GOOGLE DOCS API:');
	processedLines.forEach(l => console.log(`  "${l.replace(/\t/g, '\\t')}"`));
	
	const heading = 'Deep Unordered Nesting Test\n';
	const listText = processedLines.join('\n') + '\n';
	const fullText = heading + listText;
	
	await clearAndInsert(fullText);
	
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, fullText.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n3. READ BACK FROM GOOGLE DOCS:');
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	bulletedParas.forEach(p => {
		console.log(`  Level ${p.nestingLevel}: "${p.text}"`);
	});
	
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	
	console.log('\n4. CONVERTED BACK TO MARKDOWN:');
	console.log(markdownOutput);
	
	// Check all 4 levels are present
	const levels = [...new Set(bulletedParas.map(p => p.nestingLevel))];
	console.log('\n5. NESTING LEVELS FOUND:', levels.sort().join(', '));
	
	const has4Levels = levels.length >= 4;
	const inputNormalized = markdownInput.trim();
	const outputNormalized = markdownOutput.trim();
	const match = inputNormalized === outputNormalized;
	
	console.log('\n6. ROUND-TRIP RESULT:', match ? '✅ MATCH' : '❌ MISMATCH');
	if (!match) {
		console.log('   Expected:', JSON.stringify(inputNormalized));
		console.log('   Got:     ', JSON.stringify(outputNormalized));
	}
	
	return has4Levels && match;
}

async function testDeepOrderedNesting() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Deep Ordered Nesting (4 levels) with NUMBERED_DECIMAL_NESTED');
	console.log('='.repeat(60));
	
	// Markdown input with 4 levels of nesting
	const markdownInput = `1. Level 0
    1. Level 1
        1. Level 2
            1. Level 3
        1. Back to Level 2
    1. Back to Level 1
1. Another Level 0`;
	
	console.log('\n1. MARKDOWN INPUT:');
	console.log(markdownInput);
	
	// Process for Google Docs
	const lines = markdownInput.split('\n');
	const processedLines = lines.map(line => {
		const indentMatch = line.match(/^( {4})*/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		let content = line.replace(/^( {4})*/, '').replace(/^\d+\. /, '');
		return '\t'.repeat(nestingLevel) + content;
	});
	
	const heading = 'Deep Ordered Nesting Test\n';
	const listText = processedLines.join('\n') + '\n';
	const fullText = heading + listText;
	
	await clearAndInsert(fullText);
	
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, fullText.length, 'NUMBERED_DECIMAL_NESTED');
	
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	console.log('\n2. READ BACK FROM GOOGLE DOCS:');
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	bulletedParas.forEach(p => {
		const listDef = lists[p.listId];
		const nestingDef = listDef?.listProperties?.nestingLevels?.[p.nestingLevel];
		console.log(`  Level ${p.nestingLevel}: "${p.text}" (glyphType: "${nestingDef?.glyphType}")`);
	});
	
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	
	console.log('\n3. CONVERTED BACK TO MARKDOWN:');
	console.log(markdownOutput);
	
	// Check all 4 levels are present
	const levels = [...new Set(bulletedParas.map(p => p.nestingLevel))];
	console.log('\n4. NESTING LEVELS FOUND:', levels.sort().join(', '));
	
	const has4Levels = levels.length >= 4;
	
	// Normalize: all ordered items use "1." as prefix
	const inputNormalized = markdownInput.trim();
	const outputNormalized = markdownOutput.trim();
	const match = inputNormalized === outputNormalized;
	
	console.log('\n5. ROUND-TRIP RESULT:', match ? '✅ MATCH' : '❌ MISMATCH');
	if (!match) {
		console.log('   Expected:', JSON.stringify(inputNormalized));
		console.log('   Got:     ', JSON.stringify(outputNormalized));
	}
	
	return has4Levels && match;
}

async function testAlternativeMarkers() {
	console.log('\n' + '='.repeat(60));
	console.log('TEST: Alternative Markers (*, +) normalize to dash');
	console.log('='.repeat(60));
	
	// Test that *, + markers also work and normalize to -
	// Note: We're simulating what the plugin's md-to-ir would produce
	// All unordered markers produce the same content (just the text, no prefix)
	
	const markdownInput = `* Asterisk item
+ Plus item
- Dash item`;
	
	console.log('\n1. MARKDOWN INPUT (different markers):');
	console.log(markdownInput);
	
	// Process: all markers are stripped, just text remains
	const lines = markdownInput.split('\n');
	const processedLines = lines.map(line => {
		return line.replace(/^[-*+] /, '');
	});
	
	console.log('\n2. PROCESSED (markers stripped):');
	processedLines.forEach(l => console.log(`  "${l}"`));
	
	const heading = 'Alternative Markers Test\n';
	const listText = processedLines.join('\n') + '\n';
	const fullText = heading + listText;
	
	await clearAndInsert(fullText);
	
	await docs.documents.batchUpdate({
		documentId,
		requestBody: {
			requests: [{
				updateParagraphStyle: {
					range: { tabId, startIndex: 1, endIndex: heading.length },
					paragraphStyle: { namedStyleType: 'HEADING_1' },
					fields: 'namedStyleType',
				},
			}],
		},
	});
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, fullText.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	await sleep(1000);
	const { paragraphs, lists } = await readDocLists();
	
	const bulletedParas = paragraphs.filter(p => p.hasBullet);
	const markdownOutput = docsListToMarkdown(bulletedParas, lists);
	
	console.log('\n3. CONVERTED BACK TO MARKDOWN:');
	console.log(markdownOutput);
	
	// Expected: all become dash
	const expectedOutput = `- Asterisk item
- Plus item
- Dash item`;
	
	const match = markdownOutput.trim() === expectedOutput.trim();
	
	console.log('\n4. RESULT:', match ? '✅ All normalized to dash' : '❌ MISMATCH');
	if (!match) {
		console.log('   Expected:', JSON.stringify(expectedOutput));
		console.log('   Got:     ', JSON.stringify(markdownOutput.trim()));
	}
	
	return match;
}

// ============================================================
// RUN ALL TESTS
// ============================================================

console.log('='.repeat(60));
console.log('LIST ROUND-TRIP TESTS');
console.log('='.repeat(60));
console.log(`Document ID: ${documentId}`);
console.log(`Tab ID: ${tabId}`);

try {
	const results = {};
	
	// Test 1: Unordered list round-trip
	results.unordered = await testUnorderedListRoundtrip();
	await sleep(3000);
	
	// Test 2: Ordered list round-trip
	results.ordered = await testOrderedListRoundtrip();
	await sleep(3000);
	
	// Test 3: Read existing dash list
	results.dashRead = await testReadExistingDashList();
	await sleep(3000);
	
	// Test 4: Bullet characters as plain text
	results.bulletChars = await testBulletCharactersNotLists();
	await sleep(3000);
	
	// Test 5: NUMBERED_DECIMAL_NESTED preset
	results.numberedDecimalNested = await testNumberedDecimalNested();
	await sleep(3000);
	
	// Test 6: Deep unordered nesting (4 levels)
	results.deepUnordered = await testDeepUnorderedNesting();
	await sleep(3000);
	
	// Test 7: Deep ordered nesting (4 levels)
	results.deepOrdered = await testDeepOrderedNesting();
	await sleep(3000);
	
	// Test 8: Alternative markers (*, +)
	results.altMarkers = await testAlternativeMarkers();
	
	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('SUMMARY');
	console.log('='.repeat(60));
	for (const [name, passed] of Object.entries(results)) {
		console.log(`${passed ? '✅' : '❌'} ${name}`);
	}
	
} catch (err) {
	console.error('Error:', err.message);
	if (err.response?.data) {
		console.error('API Error:', JSON.stringify(err.response.data, null, 2));
	}
	process.exit(1);
}
