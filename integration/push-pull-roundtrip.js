/**
 * Integration test: Push/Pull roundtrip with Google Docs API
 * 
 * This test:
 * 1. Creates a test Google Doc
 * 2. Pushes markdown content (converted to plain + styles)
 * 3. Pulls content back and converts to markdown
 * 4. Verifies roundtrip fidelity
 * 5. Cleans up the test doc
 * 
 * Usage: node integration/push-pull-roundtrip.js
 * 
 * Requires: Valid OAuth tokens in .token.json (run: npm run auth)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuth, getDocs, getDrive } from '../lib/getAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDist = path.join(__dirname, '../../plugin/dist');

// Import converters from compiled plugin (use index for convenience)
const converter = await import(path.join(pluginDist, 'converter/index.js'));
const { 
  markdownToIR, 
  irToMarkdown, 
  normalizeMarkdown, 
  irToPlainTextWithRanges,
  docsToIR,
  buildDocsStyleUpdateRequests,
} = converter;

console.log('=== Push/Pull Roundtrip Integration Test ===\n');

const auth = getAuth();
const docs = getDocs(auth);
const drive = getDrive(auth);

// Test markdown
const testMarkdown = `# Integration Test Document

*A test subtitle*

This is a paragraph with **bold** and *italic* text.

## Section 1

Here's a list:

- First item
- Second item
- Third item

## Section 2

Some code:

\`\`\`javascript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

The end.`;

let testDocId = null;

try {
  // Step 1: Create test document
  console.log('1. Creating test document...');
  const createRes = await drive.files.create({
    requestBody: {
      name: `Integration Test - ${new Date().toISOString()}`,
      mimeType: 'application/vnd.google-apps.document',
    },
  });
  testDocId = createRes.data.id;
  console.log(`   Created doc: ${testDocId}`);

  // Step 2: Convert markdown to plain + styles
  console.log('2. Converting markdown to IR and plain text...');
  const ir = markdownToIR(testMarkdown);
  console.log(`   IR: ${ir.length} paragraphs`);
  
  const { plain, paraRanges, textRanges } = irToPlainTextWithRanges(ir);
  console.log(`   Plain: ${plain.length} chars`);

  // Step 3: Push to Google Doc
  console.log('3. Pushing to Google Doc...');
  
  // Get current doc state
  const docRes = await docs.documents.get({ documentId: testDocId });
  const revisionId = docRes.data.revisionId;
  
  // Insert text
  await docs.documents.batchUpdate({
    documentId: testDocId,
    requestBody: {
      requests: [
        { insertText: { location: { index: 1 }, text: plain } },
      ],
      writeControl: { requiredRevisionId: revisionId },
    },
  });
  
  // Apply styles
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, {});
  if (styleReqs.length > 0) {
    await docs.documents.batchUpdate({
      documentId: testDocId,
      requestBody: { requests: styleReqs },
    });
  }
  console.log(`   Applied ${styleReqs.length} style requests`);

  // Pause for visual inspection
  console.log('\n>>> INSPECT THE DOCUMENT <<<');
  console.log(`   https://docs.google.com/document/d/${testDocId}/edit`);
  console.log('\nWaiting 30 seconds for you to inspect... (or Ctrl+C to abort)');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Step 4: Pull from Google Doc
  console.log('4. Pulling from Google Doc...');
  const pullRes = await docs.documents.get({ documentId: testDocId });
  const pulledDoc = pullRes.data;
  
  // Step 5: Convert back to markdown
  console.log('5. Converting Docs structure back to markdown...');
  const pulledIR = docsToIR({
    body: pulledDoc.body,
    inlineObjects: pulledDoc.inlineObjects || {},
  });
  console.log(`   Pulled IR: ${pulledIR.length} paragraphs`);
  
  const pulledMarkdown = irToMarkdown(pulledIR);
  console.log(`   Pulled MD: ${pulledMarkdown.length} chars`);

  // Step 6: Compare
  console.log('6. Comparing roundtrip...');
  const originalNorm = normalizeMarkdown(testMarkdown);
  const roundtripNorm = normalizeMarkdown(pulledMarkdown);
  
  const originalLines = originalNorm.split('\n').filter(l => l.trim());
  const roundtripLines = roundtripNorm.split('\n').filter(l => l.trim());
  
  console.log(`   Original lines: ${originalLines.length}`);
  console.log(`   Roundtrip lines: ${roundtripLines.length}`);
  
  let matching = 0;
  const diffs = [];
  for (let i = 0; i < Math.max(originalLines.length, roundtripLines.length); i++) {
    const orig = originalLines[i] || '';
    const rt = roundtripLines[i] || '';
    if (orig === rt) {
      matching++;
    } else {
      diffs.push({ line: i + 1, original: orig, roundtrip: rt });
    }
  }
  
  const similarity = (matching / Math.max(originalLines.length, roundtripLines.length) * 100).toFixed(1);
  console.log(`   Similarity: ${similarity}%`);
  
  if (diffs.length > 0 && diffs.length <= 5) {
    console.log('   Differences:');
    for (const d of diffs) {
      console.log(`     Line ${d.line}:`);
      console.log(`       Original:  "${d.original}"`);
      console.log(`       Roundtrip: "${d.roundtrip}"`);
    }
  } else if (diffs.length > 5) {
    console.log(`   ${diffs.length} lines differ (showing first 3):`);
    for (const d of diffs.slice(0, 3)) {
      console.log(`     Line ${d.line}: "${d.original}" vs "${d.roundtrip}"`);
    }
  }

  // Verdict
  console.log('\n=== Result ===');
  if (similarity >= 80) {
    console.log(`✓ PASS - ${similarity}% similarity (acceptable for roundtrip)`);
  } else {
    console.log(`✗ FAIL - ${similarity}% similarity (below 80% threshold)`);
    process.exitCode = 1;
  }

} catch (err) {
  console.error('ERROR:', err.message || err);
  if (err.response?.data) {
    console.error('API Error:', JSON.stringify(err.response.data, null, 2));
  }
  process.exitCode = 1;
} finally {
  // Cleanup
  if (testDocId) {
    console.log('\nCleaning up test document...');
    try {
      await drive.files.delete({ fileId: testDocId });
      console.log('Deleted test document.');
    } catch (err) {
      console.log('Cleanup failed (manual cleanup may be needed):', err.message);
    }
  }
}

