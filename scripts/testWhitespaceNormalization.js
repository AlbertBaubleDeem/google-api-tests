import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Test script for investigating whitespace normalization in Google Docs.
 * 
 * Hypothesis: Google Docs strips/normalizes certain whitespace during insertText:
 * - Trailing tabs on blank lines
 * - Trailing whitespace at end of lines
 * - Consecutive whitespace normalization
 * 
 * This could explain discrepancies between plain.length and actual document endIndex.
 * 
 * Usage: npm run testWhitespace -- <documentId> <tabId> [testCase]
 * 
 * Test cases:
 *   basic      - Basic insertion length verification
 *   tabs       - Tabs for list nesting
 *   blanktabs  - Blank lines with tabs (suspected culprit)
 *   trailing   - Trailing whitespace on lines
 *   fullcase   - Exact markdown structure from failing case
 *   all        - Run all test cases (default)
 */

const [documentId, tabId, testCase = 'all'] = process.argv.slice(2);
if (!documentId || !tabId) {
	console.error('Usage: npm run testWhitespace -- <documentId> <tabId> [testCase]');
	console.error('Test cases: basic, tabs, blanktabs, trailing, fullcase, all');
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
 * Convert string to hex dump for comparison
 */
function toHexDump(str) {
	return Array.from(str).map(c => {
		const code = c.charCodeAt(0);
		if (code === 0x09) return '\\t';
		if (code === 0x0A) return '\\n';
		if (code === 0x0D) return '\\r';
		if (code === 0x20) return '·';  // visible space
		if (code >= 0x20 && code < 0x7F) return c;
		return `\\x${code.toString(16).padStart(2, '0')}`;
	}).join('');
}

/**
 * Clear tab content and insert new text, then analyze the result
 * @param useTabId - if false, mimics plugin behavior (no tabId in requests)
 */
async function clearAndInsertWithAnalysis(text, testName, useTabId = true) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`TEST: ${testName}${useTabId ? '' : ' (NO tabId - mimics plugin)'}`);
	console.log(`${'='.repeat(60)}`);
	
	// Get current state - always read with includeTabsContent to get actual content
	const meta = await docs.documents.get({ documentId, includeTabsContent: true });
	const revisionId = meta.data.revisionId;
	const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const last = tabBody?.content?.[tabBody.content.length - 1];
	const endIndex = last?.endIndex ?? 1;

	// Delete existing content if any, then insert new text
	// When useTabId=false, don't include tabId in requests (mimics plugin behavior)
	const requests = [];
	if (endIndex > 2) {
		if (useTabId) {
			requests.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
		} else {
			requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
		}
	}
	if (useTabId) {
		requests.push({ insertText: { location: { tabId, index: 1 }, text } });
	} else {
		requests.push({ insertText: { location: { index: 1 }, text } });
	}

	await docs.documents.batchUpdate({ 
		documentId, 
		requestBody: { requests, writeControl: { requiredRevisionId: revisionId } } 
	});
	
	// Read the document after insertion - always with includeTabsContent
	const afterInsert = await docs.documents.get({ documentId, includeTabsContent: true });
	const afterTabBody = afterInsert.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
	const afterLast = afterTabBody?.content?.[afterTabBody.content.length - 1];
	const documentEndIndex = afterLast?.endIndex ?? 1;
	
	// Also check main body endIndex (what the plugin might be seeing)
	const mainBody = afterInsert.data.body || {};
	const mainBodyContent = mainBody.content || [];
	const mainBodyEndIndex = mainBodyContent.length ? mainBodyContent[mainBodyContent.length - 1]?.endIndex : 1;
	
	console.log(`  Tab body endIndex: ${documentEndIndex}`);
	console.log(`  Main body endIndex: ${mainBodyEndIndex}`);
	if (mainBodyEndIndex !== documentEndIndex) {
		console.log(`  ⚠ MISMATCH between tab body and main body!`);
	}
	
	// Try to apply bullets to test if the range is valid
	if (!useTabId && text.includes('\t')) {
		console.log(`\n  Testing bullet application WITHOUT tabId...`);
		
		// Test 1: Small range (should work)
		const smallEndIndex = Math.min(20, text.length);
		try {
			await docs.documents.batchUpdate({
				documentId,
				requestBody: {
					requests: [{
						createParagraphBullets: {
							range: { startIndex: 1, endIndex: smallEndIndex },
							bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
						},
					}],
				},
			});
			console.log(`  ✓ Small range (1-${smallEndIndex}) succeeded`);
		} catch (err) {
			console.log(`  ✗ Small range (1-${smallEndIndex}) FAILED: ${err.response?.data?.error?.message || err.message}`);
		}
		
		// Test 2: Large range near document end (mimics plugin behavior)
		const largeEndIndex = documentEndIndex - 2; // Tab body endIndex minus 2
		try {
			await docs.documents.batchUpdate({
				documentId,
				requestBody: {
					requests: [{
						createParagraphBullets: {
							range: { startIndex: 1, endIndex: largeEndIndex },
							bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
						},
					}],
				},
			});
			console.log(`  ✓ Large range (1-${largeEndIndex}) succeeded`);
		} catch (err) {
			console.log(`  ✗ Large range (1-${largeEndIndex}) FAILED: ${err.response?.data?.error?.message || err.message}`);
		}
		
		// Test 3: Exact tab body endIndex (should fail?)
		try {
			await docs.documents.batchUpdate({
				documentId,
				requestBody: {
					requests: [{
						createParagraphBullets: {
							range: { startIndex: 1, endIndex: documentEndIndex },
							bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
						},
					}],
				},
			});
			console.log(`  ✓ Exact tab endIndex (1-${documentEndIndex}) succeeded`);
		} catch (err) {
			console.log(`  ✗ Exact tab endIndex (1-${documentEndIndex}) FAILED: ${err.response?.data?.error?.message || err.message}`);
		}
		
		// Test 4: Beyond tab body endIndex (should definitely fail)
		const beyondEndIndex = documentEndIndex + 10;
		try {
			await docs.documents.batchUpdate({
				documentId,
				requestBody: {
					requests: [{
						createParagraphBullets: {
							range: { startIndex: 1, endIndex: beyondEndIndex },
							bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
						},
					}],
				},
			});
			console.log(`  ✓ Beyond endIndex (1-${beyondEndIndex}) succeeded`);
		} catch (err) {
			console.log(`  ✗ Beyond endIndex (1-${beyondEndIndex}) FAILED: ${err.response?.data?.error?.message || err.message}`);
		}
	}
	
	// Extract actual text from the document
	let retrievedText = '';
	for (const element of (afterTabBody?.content || [])) {
		if (element.paragraph) {
			for (const el of (element.paragraph.elements || [])) {
				if (el.textRun?.content) {
					retrievedText += el.textRun.content;
				}
			}
		}
	}
	
	// Calculate metrics
	const inputLength = text.length;
	const actualContentLength = documentEndIndex - 1; // Content starts at index 1
	const discrepancy = inputLength - actualContentLength;
	
	// Output results
	console.log(`\nINPUT:`);
	console.log(`  Length: ${inputLength}`);
	console.log(`  Hex: "${toHexDump(text)}"`);
	
	console.log(`\nDOCUMENT AFTER INSERT:`);
	console.log(`  endIndex: ${documentEndIndex}`);
	console.log(`  Actual content length: ${actualContentLength}`);
	console.log(`  Retrieved text length: ${retrievedText.length}`);
	console.log(`  Retrieved hex: "${toHexDump(retrievedText)}"`);
	
	console.log(`\nANALYSIS:`);
	console.log(`  Discrepancy: ${discrepancy} characters`);
	if (discrepancy === 0) {
		console.log(`  ✓ No discrepancy - text preserved exactly`);
	} else if (discrepancy > 0) {
		console.log(`  ✗ Document is SHORTER than input by ${discrepancy} chars`);
		console.log(`  → Google Docs likely stripped/normalized some characters`);
	} else {
		console.log(`  ? Document is LONGER than input by ${-discrepancy} chars`);
		console.log(`  → Unexpected: Google Docs added characters`);
	}
	
	// Compare character by character if there's a discrepancy
	if (discrepancy !== 0) {
		console.log(`\nCHARACTER COMPARISON:`);
		const maxLen = Math.max(inputLength, retrievedText.length);
		let diffStart = -1;
		for (let i = 0; i < maxLen; i++) {
			const inputChar = text[i];
			const retrievedChar = retrievedText[i];
			if (inputChar !== retrievedChar) {
				if (diffStart === -1) diffStart = i;
				const inputCode = inputChar ? `0x${inputChar.charCodeAt(0).toString(16)}` : 'EOF';
				const retrievedCode = retrievedChar ? `0x${retrievedChar.charCodeAt(0).toString(16)}` : 'EOF';
				console.log(`  Position ${i}: input=${inputCode} (${toHexDump(inputChar || '')}) vs retrieved=${retrievedCode} (${toHexDump(retrievedChar || '')})`);
				// Only show first 10 differences
				if (i - diffStart > 10) {
					console.log(`  ... (more differences)`);
					break;
				}
			}
		}
	}
	
	return { inputLength, documentEndIndex, actualContentLength, discrepancy, retrievedText };
}

// Test cases
const testCases = {
	// Test 1: Basic insertion length verification
	basic: {
		name: 'Basic insertion (no special whitespace)',
		text: 'Hello\nWorld\n',
	},
	
	// Test 2: Tabs for list nesting
	tabs: {
		name: 'Tabs for list nesting',
		text: 'Item 0\n\tItem 1\n\t\tItem 2\n',
	},
	
	// Test 3: Blank lines with tabs (suspected culprit)
	blanktabs: {
		name: 'Blank lines with tabs (SUSPECTED CULPRIT)',
		text: 'Item 0\n\tItem 1\n\t\tItem 2\n\t\t\nNot a list\n',
	},
	
	// Test 4: Trailing whitespace on lines
	trailing: {
		name: 'Trailing whitespace on lines',
		text: 'Line with trailing spaces   \nNext line\n',
	},
	
	// Test 5: Exact markdown structure from failing case
	fullcase: {
		name: 'Full structure from failing case',
		text: `# LIST TEST

\tItem level 0
\t\tItem level 1
\t\t\tItem level 2
\t\t\t
No more list
`,
	},
	
	// Test 6: Multiple blank lines with varying tabs
	multiblanks: {
		name: 'Multiple blank lines with varying tabs',
		text: 'Start\n\t\n\t\t\n\t\t\t\nEnd\n',
	},
	
	// Test 7: Consecutive tabs within text
	consec: {
		name: 'Consecutive tabs within text',
		text: 'Before\t\t\tAfter\n',
	},
	
	// Test 8: Realistic nested lists structure (matching plugin output)
	nestedlists: {
		name: 'Realistic nested lists with normal text after',
		text: `# LIST TEST

list level 0 1st line
list level 0 2nd line
\tlist level 1 1st line
\t\tlist level 2 1st line
ordered list level 0 1st line
ordered list level 0 2nd line
\tordered list level 1 1st line
\tordered list level 1 2nd line
\t\tordered list level 2

No more list
`,
	},
	
	// Test 9: Deep nesting (3 levels) followed by normal text - exact failing scenario
	deepnest: {
		name: 'Deep nesting (3 levels) then normal text',
		text: `- bullet 0
\t- bullet 1
\t\t- bullet 2
1. number 0
\t1. number 1
\t\t1. number 2

not a list
`,
	},
	
	// Test 10: Same as deepnest but WITHOUT tabId (mimics plugin behavior)
	deepnest_notabid: {
		name: 'Deep nesting WITHOUT tabId',
		text: `- bullet 0
\t- bullet 1
\t\t- bullet 2
1. number 0
\t1. number 1
\t\t1. number 2

not a list
`,
		useTabId: false,
	},
	
	// Test 11: Nested lists without tabId
	nestedlists_notabid: {
		name: 'Realistic nested lists WITHOUT tabId',
		text: `# LIST TEST

list level 0 1st line
list level 0 2nd line
\tlist level 1 1st line
\t\tlist level 2 1st line
ordered list level 0 1st line
ordered list level 0 2nd line
\tordered list level 1 1st line
\tordered list level 1 2nd line
\t\tordered list level 2

No more list
`,
		useTabId: false,
	},
};

async function runTest(name) {
	const tc = testCases[name];
	if (!tc) {
		console.error(`Unknown test case: ${name}`);
		return null;
	}
	const useTabId = tc.useTabId !== false; // default to true
	return clearAndInsertWithAnalysis(tc.text, tc.name, useTabId);
}

async function runAllTests() {
	const results = {};
	for (const [name, tc] of Object.entries(testCases)) {
		results[name] = await runTest(name);
		// Small delay between tests
		await new Promise(r => setTimeout(r, 1000));
	}
	
	// Summary
	console.log(`\n${'='.repeat(60)}`);
	console.log('SUMMARY');
	console.log(`${'='.repeat(60)}`);
	
	let totalDiscrepancy = 0;
	for (const [name, result] of Object.entries(results)) {
		if (result) {
			const status = result.discrepancy === 0 ? '✓' : '✗';
			console.log(`${status} ${name}: discrepancy = ${result.discrepancy}`);
			totalDiscrepancy += Math.abs(result.discrepancy);
		}
	}
	
	console.log(`\nTotal absolute discrepancy: ${totalDiscrepancy} characters`);
	if (totalDiscrepancy > 0) {
		console.log(`\nHYPOTHESIS LIKELY CONFIRMED: Google Docs normalizes whitespace during insertion.`);
	} else {
		console.log(`\nHYPOTHESIS REJECTED: No whitespace normalization detected.`);
	}
	
	return results;
}

// Main
(async () => {
	try {
		if (testCase === 'all') {
			await runAllTests();
		} else {
			await runTest(testCase);
		}
	} catch (err) {
		console.error('Error:', err.message);
		if (err.response?.data) {
			console.error('API Error:', JSON.stringify(err.response.data, null, 2));
		}
		process.exit(1);
	}
})();
