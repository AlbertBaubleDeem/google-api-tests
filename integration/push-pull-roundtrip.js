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
import fs from 'fs';
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

// Test markdown with multiline code block and numbered lists
const testMarkdown = `# Integration Test Document

_A test subtitle_

This is a paragraph with **bold** and *italic* text.

## Section 1

Here's an unordered list:

- First item
- Second item
- Third item

And here's a numbered list:

1. Step one
2. Step two
3. Step three

## Section 2

Some code with multiple lines:

\`\`\`javascript
function greet(name) {
  const greeting = "Hello, " + name + "!";
  console.log(greeting);
  return greeting;
}

greet("World");
\`\`\`

Text after the code block.

## Section 3: Inline Code

This paragraph has \`inline code\` followed by normal text.

Another with \`multiple\` inline \`code\` segments mixed in.

Normal paragraph with no code at all.

The end.`;

// Save original markdown to temp file
const tempDir = path.join(__dirname, '../local');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
const originalFile = path.join(tempDir, 'test-original.md');
const roundtripFile = path.join(tempDir, 'test-roundtrip.md');
fs.writeFileSync(originalFile, testMarkdown);
console.log(`Saved original to: ${originalFile}`);

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
  
  // Verbose font logging to debug inline code vs code block detection
  console.log('\n=== VERBOSE FONT LOGGING ===');
  let paraIndex = 0;
  for (const el of pulledDoc.body?.content || []) {
    if (el.paragraph) {
      const textPreview = (el.paragraph.elements || [])
        .map(e => e.textRun?.content || '[obj]')
        .join('')
        .substring(0, 50)
        .replace(/\n/g, '\\n');
      const ps = el.paragraph.paragraphStyle || {};
      console.log(`\n--- Paragraph ${paraIndex}: "${textPreview}..." ---`);
      console.log(`  paragraphStyle: shading=${ps.shading ? 'YES' : 'no'}, borderLeft=${ps.borderLeft ? 'YES' : 'no'}, namedStyle=${ps.namedStyleType || 'none'}`);
      
      for (const run of el.paragraph.elements || []) {
        if (run.textRun) {
          const text = (run.textRun.content || '').substring(0, 30).replace(/\n/g, '\\n');
          const font = run.textRun.textStyle?.weightedFontFamily?.fontFamily || 'EMPTY';
          const bold = run.textRun.textStyle?.bold ? 'B' : '';
          const italic = run.textRun.textStyle?.italic ? 'I' : '';
          console.log(`    "${text}" => font: "${font}" ${bold}${italic}`);
        } else if (run.inlineObjectElement) {
          console.log(`    [inline object: ${run.inlineObjectElement.inlineObjectId}]`);
        }
      }
      paraIndex++;
    }
  }
  console.log('\n=== END FONT LOGGING ===\n');
  
  // Step 5: Convert back to markdown
  console.log('5. Converting Docs structure back to markdown...');
  const pulledIR = docsToIR({
    body: pulledDoc.body,
    inlineObjects: pulledDoc.inlineObjects || {},
  });
  console.log(`   Pulled IR: ${pulledIR.length} paragraphs`);
  
  const pulledMarkdown = irToMarkdown(pulledIR);
  console.log(`   Pulled MD: ${pulledMarkdown.length} chars`);
  
  // Save roundtrip markdown to temp file
  fs.writeFileSync(roundtripFile, pulledMarkdown);
  console.log(`   Saved roundtrip to: ${roundtripFile}`);

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

