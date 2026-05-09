import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Test script for creating native Google Docs lists using CreateParagraphBulletsRequest.
 * 
 * Usage: npm run createList -- <documentId> <tabId> [testCase]
 * 
 * Test cases:
 *   unordered  - Simple unordered list (3 items)
 *   ordered    - Simple ordered list (3 items)
 *   nested     - Nested list (2 levels)
 *   mixed      - Mixed content (heading, list, paragraph)
 *   all        - Run all test cases (default)
 */

const [documentId, tabId, testCase = 'all'] = process.argv.slice(2);
if (!documentId || !tabId) {
	console.error('Usage: npm run createList -- <documentId> <tabId> [testCase]');
	console.error('Test cases: unordered, ordered, nested, mixed, all');
	process.exit(1);
}

// Setup auth
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

/**
 * Clear tab content and insert new text
 * Removes bullet formatting from NEW content to prevent list inheritance
 */
async function clearAndInsert(text) {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const revisionId = meta.data.revisionId;
	const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const last = tabBody?.content?.[tabBody.content.length - 1];
	const endIndex = last?.endIndex ?? 1;

	// Step 1: Delete existing content if any
	const deleteReqs = [];
	if (endIndex > 2) {
		deleteReqs.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
	}
	deleteReqs.push({ insertText: { location: { tabId, index: 1 }, text } });

	await docs.documents.batchUpdate({ 
		documentId, 
		requestBody: { requests: deleteReqs, writeControl: { requiredRevisionId: revisionId } } 
	});
	
	// Step 2: Remove any inherited bullet formatting from ALL content (including trailing newline)
	const afterInsert = await docs.documents.get({ documentId, includeTabsContent: true });
	const afterTabBody = afterInsert.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const afterLast = afterTabBody?.content?.[afterTabBody.content.length - 1];
	const actualEndIndex = afterLast?.endIndex ?? 1;
	
	console.log(`After insert, document endIndex: ${actualEndIndex}`);
	
	// Clear bullets from ENTIRE document including trailing paragraph
	// Use actualEndIndex (not -1) to include the very last paragraph
	if (actualEndIndex > 1) {
		await docs.documents.batchUpdate({
			documentId,
			requestBody: { requests: [{ deleteParagraphBullets: { range: { tabId, startIndex: 1, endIndex: actualEndIndex } } }] }
		});
	}
	
	// Verify bullets are cleared
	const afterClear = await docs.documents.get({ documentId, includeTabsContent: true });
	const clearBody = afterClear.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const hasBulletsAfterClear = (clearBody?.content || []).some(se => se.paragraph?.bullet);
	console.log(`Bullets remaining after clear: ${hasBulletsAfterClear}`);
	if (hasBulletsAfterClear) {
		const bulletParas = (clearBody?.content || [])
			.filter(se => se.paragraph?.bullet)
			.map(se => ({ startIndex: se.startIndex, listId: se.paragraph?.bullet?.listId }));
		console.log('Paragraphs still with bullets:', bulletParas);
	}
	
	return text.length;
}

/**
 * Apply bullet formatting to a range
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
 * Read back the document structure for verification
 */
async function readDocStructure() {
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const lists = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.lists || {};
	
	const paragraphs = (tabBody?.content || [])
		.filter(se => se.paragraph)
		.map((se, idx) => {
			const p = se.paragraph;
			const text = p.elements?.map(e => e.textRun?.content || '').join('').trim();
			const bullet = p.bullet;
			return {
				idx,
				startIndex: se.startIndex,
				endIndex: se.endIndex,
				text: text?.substring(0, 40),
				hasBullet: !!bullet,
				listId: bullet?.listId,
				nestingLevel: bullet?.nestingLevel,
			};
		});
	
	return { paragraphs, lists };
}

/**
 * Apply heading style to a range
 */
async function applyHeadingStyle(startIndex, endIndex) {
	const req = {
		updateParagraphStyle: {
			range: { tabId, startIndex, endIndex },
			paragraphStyle: { namedStyleType: 'HEADING_1' },
			fields: 'namedStyleType',
		},
	};
	await docs.documents.batchUpdate({ documentId, requestBody: { requests: [req] } });
}

/**
 * Test 1: Simple unordered list
 */
async function testUnorderedList() {
	console.log('\n=== Test: Simple Unordered List ===');
	
	// Insert heading + list items
	const heading = 'Simple Unordered List\n';
	const listText = 'First item\nSecond item\nThird item\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Apply unordered bullet formatting (after heading)
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Verify all items have bullets
	const bulletedItems = result.paragraphs.filter(p => p.hasBullet);
	console.log(`✓ Bulleted items: ${bulletedItems.length}/3`);
	
	return bulletedItems.length === 3;
}

/**
 * Test 2: Simple ordered list
 */
async function testOrderedList() {
	console.log('\n=== Test: Simple Ordered List ===');
	
	const heading = 'Simple Ordered List\n';
	const listText = 'Step one\nStep two\nStep three\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Apply numbered list formatting
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'NUMBERED_DECIMAL_ALPHA_ROMAN');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	const bulletedItems = result.paragraphs.filter(p => p.hasBullet);
	console.log(`✓ Numbered items: ${bulletedItems.length}/3`);
	
	return bulletedItems.length === 3;
}

/**
 * Test 3: Nested list (using tabs for nesting)
 */
async function testNestedList() {
	console.log('\n=== Test: Nested List (2 levels) ===');
	
	const heading = 'Nested List (2 levels)\n';
	// Use tabs for nesting: \t = level 1, \t\t = level 2, etc.
	const listText = 'Parent item 1\n\tChild item 1.1\n\tChild item 1.2\nParent item 2\n\tChild item 2.1\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Apply bullet formatting to the list
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Check nesting levels
	const nestedItems = result.paragraphs.filter(p => p.nestingLevel > 0);
	console.log(`✓ Nested items (level > 0): ${nestedItems.length}`);
	console.log('Nesting levels:', result.paragraphs.map(p => p.nestingLevel));
	
	return nestedItems.length >= 3;
}

/**
 * Test 4: Mixed content (heading, list, paragraph)
 */
async function testMixedContent() {
	console.log('\n=== Test: Mixed Content ===');
	
	// Insert mixed content: heading, list items, then regular paragraph
	const heading = 'Mixed Content Test\n';
	const listItems = 'Apples\nBananas\nOranges\n';
	const paragraph = 'Remember to check prices!\n';
	
	const text = heading + listItems + paragraph;
	await clearAndInsert(text);
	
	// Apply heading style to first line
	await applyHeadingStyle(1, heading.length);
	
	// Calculate list range (after heading, before final paragraph)
	const listStart = 1 + heading.length;
	const listEnd = listStart + listItems.length;
	
	// Apply bullets only to the list items
	await applyBullets(listStart, listEnd, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Verify: heading (no bullet), 3 list items (bullets), paragraph (no bullet)
	const bulletedItems = result.paragraphs.filter(p => p.hasBullet);
	const headingPara = result.paragraphs.find(p => !p.hasBullet && p.text?.includes('Mixed'));
	const finalPara = result.paragraphs.find(p => !p.hasBullet && p.text?.includes('Remember'));
	
	console.log(`✓ Bulleted items: ${bulletedItems.length}/3`);
	console.log(`✓ Heading preserved: ${!!headingPara}`);
	console.log(`✓ Final paragraph preserved: ${!!finalPara}`);
	
	return bulletedItems.length === 3 && headingPara && finalPara;
}

/**
 * Test 5: Deeply nested list (3 levels)
 */
async function testDeeplyNestedList() {
	console.log('\n=== Test: Deeply Nested List (3 levels) ===');
	
	const heading = 'Deeply Nested List (4 levels)\n';
	const listText = 'Level 0 item\n\tLevel 1 item\n\t\tLevel 2 item\n\t\t\tLevel 3 item\n\tBack to level 1\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Check we have items at different nesting levels
	const levels = [...new Set(result.paragraphs.map(p => p.nestingLevel).filter(l => l !== undefined))];
	console.log('Unique nesting levels:', levels);
	
	return levels.length >= 3;
}

/**
 * Test 6: Ordered nested list
 */
async function testOrderedNestedList() {
	console.log('\n=== Test: Ordered Nested List ===');
	
	const heading = 'Ordered Nested List\n';
	const listText = 'First main item\n\tSub-item A\n\tSub-item B\nSecond main item\n\tSub-item C\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'NUMBERED_DECIMAL_ALPHA_ROMAN');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	const nestedItems = result.paragraphs.filter(p => p.nestingLevel > 0);
	console.log(`✓ Nested numbered items: ${nestedItems.length}`);
	
	return nestedItems.length >= 3;
}

/**
 * Test 7: Markdown dashed list (simulates plugin workflow)
 * This test simulates what the plugin does: strip dash prefixes, then apply bullets
 */
async function testDashedList() {
	console.log('\n=== Test: Markdown Dashed List (Plugin Workflow) ===');
	
	const heading = 'Dashed List (Markdown Style)\n';
	
	// Simulate markdown input with dashes
	const markdownItems = [
		'- First dashed item',
		'- Second dashed item',
		'    - Nested dashed item',  // 4-space indent = nesting level 1
		'    - Another nested item',
		'- Back to top level',
	];
	
	console.log('Original markdown-style input:');
	markdownItems.forEach(item => console.log(`  "${item}"`));
	
	// Strip prefixes and convert to plain text with tabs (what plugin does)
	const processedItems = markdownItems.map(item => {
		// Count leading 4-space groups for nesting
		const indentMatch = item.match(/^( {4})+/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		
		// Strip indentation
		let content = indentMatch ? item.slice(indentMatch[0].length) : item;
		
		// Strip the "- " prefix
		content = content.replace(/^-\s+/, '');
		
		// Add tabs for nesting
		return '\t'.repeat(nestingLevel) + content;
	});
	
	console.log('After processing (tabs for nesting, no prefixes):');
	processedItems.forEach(item => console.log(`  "${item.replace(/\t/g, '\\t')}"`));
	
	const listText = processedItems.join('\n') + '\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Apply bullets
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	const bulletedItems = result.paragraphs.filter(p => p.hasBullet);
	const nestedItems = result.paragraphs.filter(p => p.nestingLevel > 0);
	
	console.log(`✓ Total bulleted items: ${bulletedItems.length}/5`);
	console.log(`✓ Nested items (level > 0): ${nestedItems.length}/2`);
	
	return bulletedItems.length === 5 && nestedItems.length === 2;
}

/**
 * Test 8: Nested dashed list (3 levels with markdown-style input)
 */
async function testNestedDashedList() {
	console.log('\n=== Test: Nested Dashed List (3 levels) ===');
	
	const heading = 'Nested Dashed List (4 levels)\n';
	
	// Simulate markdown with 3 levels of nesting
	const markdownItems = [
		'- Level 0 item',
		'    - Level 1 item',
		'        - Level 2 item',
		'            - Level 3 item',
		'        - Back to level 2',
		'    - Back to level 1',
		'- Another level 0',
	];
	
	console.log('Original markdown-style input:');
	markdownItems.forEach(item => console.log(`  "${item}"`));
	
	// Process: strip prefixes, convert 4-space indent to tabs
	const processedItems = markdownItems.map(item => {
		const indentMatch = item.match(/^( {4})+/);
		const nestingLevel = indentMatch ? indentMatch[0].length / 4 : 0;
		let content = indentMatch ? item.slice(indentMatch[0].length) : item;
		content = content.replace(/^-\s+/, '');
		return '\t'.repeat(nestingLevel) + content;
	});
	
	const listText = processedItems.join('\n') + '\n';
	const text = heading + listText;
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	const listStart = 1 + heading.length;
	await applyBullets(listStart, text.length, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Check nesting levels
	const levels = result.paragraphs
		.filter(p => p.hasBullet)
		.map(p => p.nestingLevel || 0);
	
	console.log('Nesting levels:', levels);
	
	const uniqueLevels = [...new Set(levels)];
	console.log(`✓ Unique nesting levels: ${uniqueLevels.length} (expected 4: 0,1,2,3)`);
	
	return uniqueLevels.length >= 4;
}

/**
 * Test 9: Two separate lists (unordered then ordered) - CRITICAL for plugin
 * This tests what happens when we apply different presets to different ranges
 */
async function testTwoLists() {
	console.log('\n=== Test: Two Separate Lists (Unordered + Ordered) ===');
	
	const heading = 'Two Lists Test\n';
	const unorderedItems = 'Bullet item 1\nBullet item 2\n\tNested bullet\n';
	const separator = 'Some text between lists\n';
	const orderedItems = 'Step 1\nStep 2\n\tNested step\n';
	
	const text = heading + unorderedItems + separator + orderedItems;
	console.log('Full text being inserted:');
	console.log(text.replace(/\t/g, '\\t').replace(/\n/g, '\\n\n'));
	
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Calculate ranges - don't include trailing newlines in bullet ranges
	const unorderedStart = 1 + heading.length;
	const unorderedEnd = unorderedStart + unorderedItems.length - 1;  // -1 to exclude trailing \n
	const orderedStart = unorderedEnd + separator.length;  // separator includes the \n from unordered
	const orderedEnd = orderedStart + orderedItems.length - 1;  // -1 to exclude trailing \n
	
	console.log(`Unordered range: [${unorderedStart}, ${unorderedEnd})`);
	console.log(`Ordered range: [${orderedStart}, ${orderedEnd})`);
	
	// Apply unordered bullets first
	console.log('Applying BULLET_DISC_CIRCLE_SQUARE to unordered range...');
	await applyBullets(unorderedStart, unorderedEnd, 'BULLET_DISC_CIRCLE_SQUARE');
	
	// Apply ordered bullets second
	console.log('Applying NUMBERED_DECIMAL_NESTED to ordered range...');
	await applyBullets(orderedStart, orderedEnd, 'NUMBERED_DECIMAL_NESTED');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Verify: 3 unordered bullets, 1 separator (no bullet), 3 ordered bullets
	const unorderedBullets = result.paragraphs.filter(p => 
		p.hasBullet && p.startIndex >= unorderedStart && p.startIndex < unorderedEnd
	);
	const orderedBullets = result.paragraphs.filter(p => 
		p.hasBullet && p.startIndex >= orderedStart && p.startIndex < orderedEnd
	);
	const separatorPara = result.paragraphs.find(p => 
		p.text?.includes('Some text') && !p.hasBullet
	);
	
	console.log(`✓ Unordered bullets: ${unorderedBullets.length}/3`);
	console.log(`✓ Ordered bullets: ${orderedBullets.length}/3`);
	console.log(`✓ Separator preserved: ${!!separatorPara}`);
	
	// Check if they have DIFFERENT listIds (should be separate lists)
	const unorderedListIds = [...new Set(unorderedBullets.map(p => p.listId))];
	const orderedListIds = [...new Set(orderedBullets.map(p => p.listId))];
	console.log(`Unordered listIds: ${unorderedListIds}`);
	console.log(`Ordered listIds: ${orderedListIds}`);
	
	const differentLists = unorderedListIds[0] !== orderedListIds[0];
	console.log(`✓ Different list IDs: ${differentLists}`);
	
	return unorderedBullets.length === 3 && orderedBullets.length === 3 && separatorPara && differentLists;
}

/**
 * Test 10: Adjacent lists (unordered immediately followed by ordered) - CRITICAL
 * This is exactly what the Joplin plugin needs to handle
 */
async function testAdjacentLists() {
	console.log('\n=== Test: Adjacent Lists (No Separator) ===');
	
	const heading = 'Adjacent Lists\n';
	const unorderedItems = 'Bullet A\nBullet B\n\tNested bullet\n';
	const orderedItems = 'Step 1\nStep 2\n\tNested step\n';
	
	const text = heading + unorderedItems + orderedItems;
	console.log('Full text being inserted:');
	console.log(text.replace(/\t/g, '\\t').replace(/\n/g, '\\n\n'));
	
	await clearAndInsert(text);
	
	// Apply heading style
	await applyHeadingStyle(1, heading.length);
	
	// Calculate ranges - lists are ADJACENT, don't include trailing newlines
	const unorderedStart = 1 + heading.length;
	const unorderedEnd = unorderedStart + unorderedItems.length - 1;  // -1 to exclude trailing \n
	const orderedStart = unorderedEnd;  // Starts right where unordered ends (at the \n position)
	const orderedEnd = orderedStart + orderedItems.length - 1;  // -1 to exclude trailing \n
	
	console.log(`Unordered range: [${unorderedStart}, ${unorderedEnd})`);
	console.log(`Ordered range: [${orderedStart}, ${orderedEnd})`);
	
	// Apply unordered bullets first
	console.log('Applying BULLET_DISC_CIRCLE_SQUARE to unordered range...');
	await applyBullets(unorderedStart, unorderedEnd, 'BULLET_DISC_CIRCLE_SQUARE');
	
	// Apply ordered bullets second
	console.log('Applying NUMBERED_DECIMAL_NESTED to ordered range...');
	await applyBullets(orderedStart, orderedEnd, 'NUMBERED_DECIMAL_NESTED');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	// Check list IDs
	const unorderedBullets = result.paragraphs.filter(p => 
		p.hasBullet && p.startIndex >= unorderedStart && p.startIndex < unorderedEnd
	);
	const orderedBullets = result.paragraphs.filter(p => 
		p.hasBullet && p.startIndex >= orderedStart
	);
	
	console.log(`✓ Unordered bullets: ${unorderedBullets.length}/3`);
	console.log(`✓ Ordered bullets found: ${orderedBullets.length}`);
	
	const unorderedListIds = [...new Set(unorderedBullets.map(p => p.listId))];
	const orderedListIds = [...new Set(orderedBullets.map(p => p.listId))];
	console.log(`Unordered listIds: ${unorderedListIds}`);
	console.log(`Ordered listIds: ${orderedListIds}`);
	
	const differentLists = unorderedListIds.length > 0 && orderedListIds.length > 0 && 
		unorderedListIds[0] !== orderedListIds[0];
	console.log(`✓ Different list IDs: ${differentLists}`);
	
	return unorderedBullets.length === 3 && orderedBullets.length >= 3 && differentLists;
}

/**
 * Test 10b: Adjacent lists WITH text separator - THE FIX
 * Empty lines don't work! Need actual text to break list continuity.
 */
async function testAdjacentWithSeparator() {
	console.log('\n=== Test: Adjacent Lists WITH Text Separator ===');
	
	const heading = 'Text Separator Test\n';
	const unorderedItems = 'Bullet A\nBullet B\n';
	const separator = '---\n';  // Actual text separator (like markdown hr)
	const orderedItems = 'Step 1\nStep 2\n';
	
	const text = heading + unorderedItems + separator + orderedItems;
	console.log('Full text:', JSON.stringify(text));
	
	await clearAndInsert(text);
	await applyHeadingStyle(1, heading.length);
	
	const unorderedStart = 1 + heading.length;
	const unorderedEnd = unorderedStart + unorderedItems.length;
	// Separator is at unorderedEnd, length 4 (---\n)
	const orderedStart = unorderedEnd + separator.length;
	const orderedEnd = orderedStart + orderedItems.length;
	
	console.log(`Unordered range: [${unorderedStart}, ${unorderedEnd}) - NOT including separator`);
	console.log(`Separator at: [${unorderedEnd}, ${orderedStart})`);
	console.log(`Ordered range: [${orderedStart}, ${orderedEnd})`);
	
	// Apply unordered bullets (NOT including separator)
	await applyBullets(unorderedStart, unorderedEnd, 'BULLET_DISC_CIRCLE_SQUARE');
	
	// Apply ordered bullets (starting AFTER separator)
	await applyBullets(orderedStart, orderedEnd, 'NUMBERED_DECIMAL_NESTED');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	const allListIds = [...new Set(result.paragraphs.filter(p => p.hasBullet).map(p => p.listId))];
	const separatorPara = result.paragraphs.find(p => p.text === '---');
	console.log(`Separator paragraph bulleted: ${separatorPara?.hasBullet}`);
	console.log(`Unique listIds: ${allListIds.length} (should be 2)`);
	
	return allListIds.length === 2 && !separatorPara?.hasBullet;
}

/**
 * Test 10c: Adjacent lists but apply in REVERSE order
 */
async function testAdjacentListsReverse() {
	console.log('\n=== Test: Adjacent Lists (Reverse Order) ===');
	
	const heading = 'Adjacent Reverse\n';
	const unorderedItems = 'Bullet A\nBullet B\n\tNested bullet\n';
	const orderedItems = 'Step 1\nStep 2\n\tNested step\n';
	
	const text = heading + unorderedItems + orderedItems;
	await clearAndInsert(text);
	await applyHeadingStyle(1, heading.length);
	
	const unorderedStart = 1 + heading.length;
	const unorderedEnd = unorderedStart + unorderedItems.length;
	const orderedStart = unorderedEnd;
	const orderedEnd = orderedStart + orderedItems.length;
	
	console.log(`Unordered range: [${unorderedStart}, ${unorderedEnd})`);
	console.log(`Ordered range: [${orderedStart}, ${orderedEnd})`);
	
	// Apply in REVERSE order: ordered first, then unordered
	console.log('Applying NUMBERED_DECIMAL_NESTED to ordered range FIRST...');
	await applyBullets(orderedStart, orderedEnd, 'NUMBERED_DECIMAL_NESTED');
	
	console.log('Applying BULLET_DISC_CIRCLE_SQUARE to unordered range SECOND...');
	await applyBullets(unorderedStart, unorderedEnd, 'BULLET_DISC_CIRCLE_SQUARE');
	
	const result = await readDocStructure();
	console.log('Paragraphs:', JSON.stringify(result.paragraphs, null, 2));
	
	const allListIds = [...new Set(result.paragraphs.filter(p => p.hasBullet).map(p => p.listId))];
	console.log(`All unique listIds: ${allListIds.length}`);
	
	return allListIds.length === 2;
}

/**
 * Test 11: Show ALL available bullet presets one by one
 * This displays every bullet preset Google Docs API supports
 */
async function testAllBulletPresets() {
	console.log('\n=== Test: All Available Bullet Presets ===');
	
	// All available bullet presets from Google Docs API
	const presets = [
		'BULLET_DISC_CIRCLE_SQUARE',
		'BULLET_DIAMONDX_ARROW3D_SQUARE',
		'BULLET_CHECKBOX',
		'BULLET_ARROW_DIAMOND_DISC',
		'BULLET_STAR_CIRCLE_SQUARE',
		'BULLET_ARROW3D_CIRCLE_SQUARE',
		'BULLET_LEFTTRIANGLE_DIAMOND_DISC',
		'NUMBERED_DECIMAL_ALPHA_ROMAN',
		'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
		'NUMBERED_DECIMAL_NESTED',
		'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
		'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
		'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',
	];
	
	// Show each preset one at a time with nested items
	for (let i = 0; i < presets.length; i++) {
		const preset = presets[i];
		console.log(`\n--- Showing preset ${i + 1}/${presets.length}: ${preset} ---`);
		
		const heading = `${preset}\n`;
		const listText = 'Level 0 item\n\tLevel 1 item\n\t\tLevel 2 item\n';
		const text = heading + listText;
		
		await clearAndInsert(text);
		await applyHeadingStyle(1, heading.length);
		
		const listStart = 1 + heading.length;
		await applyBullets(listStart, text.length, preset);
		
		console.log(`✓ Applied ${preset}`);
		
		// Pause to let user see each preset
		if (i < presets.length - 1) {
			console.log(`⏳ Pausing 3s to view this preset...`);
			await sleep(3000);
		}
	}
	
	console.log('\n✓ All presets shown!');
	console.log('Total presets:', presets.length);
	
	return true;
}

// Run tests
console.log(`Running test case: ${testCase}`);
console.log(`Document ID: ${documentId}`);
console.log(`Tab ID: ${tabId}`);

const tests = {
	unordered: testUnorderedList,
	ordered: testOrderedList,
	nested: testNestedList,
	mixed: testMixedContent,
	deep: testDeeplyNestedList,
	orderedNested: testOrderedNestedList,
	dashed: testDashedList,
	nestedDashed: testNestedDashedList,
	twoLists: testTwoLists,
	adjacent: testAdjacentLists,
	withSeparator: testAdjacentWithSeparator,
	adjacentReverse: testAdjacentListsReverse,
	allPresets: testAllBulletPresets,
};

// Helper function to pause for visual inspection
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const PAUSE_BETWEEN_TESTS = 5000; // 5 seconds

try {
	if (testCase === 'all') {
		let passed = 0;
		let failed = 0;
		const testEntries = Object.entries(tests);
		for (let i = 0; i < testEntries.length; i++) {
			const [name, testFn] = testEntries[i];
			try {
				const result = await testFn();
				if (result) {
					passed++;
					console.log(`\n✅ ${name}: PASSED`);
				} else {
					failed++;
					console.log(`\n❌ ${name}: FAILED`);
				}
				// Pause between tests for visual inspection (except after last test)
				if (i < testEntries.length - 1) {
					console.log(`\n⏳ Pausing ${PAUSE_BETWEEN_TESTS/1000}s for visual inspection... (check the doc)`);
					await sleep(PAUSE_BETWEEN_TESTS);
				}
			} catch (err) {
				failed++;
				console.error(`\n❌ ${name}: ERROR - ${err.message}`);
			}
		}
		console.log(`\n========== Summary ==========`);
		console.log(`Passed: ${passed}/${passed + failed}`);
		console.log(`Failed: ${failed}/${passed + failed}`);
	} else if (tests[testCase]) {
		const result = await tests[testCase]();
		console.log(`\n${result ? '✅ PASSED' : '❌ FAILED'}`);
	} else {
		console.error(`Unknown test case: ${testCase}`);
		console.error('Available: unordered, ordered, nested, mixed, deep, orderedNested, all');
		process.exit(1);
	}
} catch (err) {
	console.error('Error:', err.message);
	if (err.response?.data) {
		console.error('API Error:', JSON.stringify(err.response.data, null, 2));
	}
	process.exit(1);
}
