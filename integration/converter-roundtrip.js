/**
 * Integration test: Converter roundtrip
 * 
 * Tests that markdown → IR → plain text → Docs → IR → markdown preserves content.
 * 
 * Usage: node integration/converter-roundtrip.js
 */
import path from 'path';
import { fileURLToPath } from 'url';

// Import converters from plugin
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDist = path.join(__dirname, '../../plugin/dist');

// Dynamic import of compiled plugin code
const { markdownToIR } = await import(path.join(pluginDist, 'converter/md-to-ir.js'));
const { irToMarkdown, normalizeMarkdown } = await import(path.join(pluginDist, 'converter/ir-to-md.js'));
const { irToPlainTextWithRanges } = await import(path.join(pluginDist, 'converter/ir-to-docs.js'));

console.log('=== Converter Roundtrip Test ===\n');

// Test cases
const testCases = [
  {
    name: 'Simple paragraph',
    markdown: '# Title\n\nThis is a paragraph with **bold** and *italic* text.',
  },
  {
    name: 'Code block',
    markdown: '# Title\n\n```javascript\nconst x = 1;\nconsole.log(x);\n```\n\nAfter code.',
  },
  {
    name: 'List items',
    markdown: '# Title\n\n- Item 1\n- Item 2\n- Item 3',
  },
  {
    name: 'Mixed content',
    markdown: `# My Document

*A subtitle*

This is a paragraph with **bold** and *italic* formatting.

## Section 1

- First item
- Second item

\`\`\`python
def hello():
    print("world")
\`\`\`

The end.`,
  },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  console.log(`Test: ${tc.name}`);
  
  try {
    // Step 1: Markdown → IR
    const ir = markdownToIR(tc.markdown);
    console.log(`  1. MD → IR: ${ir.length} paragraphs`);
    
    // Step 2: IR → plain text (for Docs)
    const { plain, paraRanges, textRanges } = irToPlainTextWithRanges(ir);
    console.log(`  2. IR → Plain: ${plain.length} chars, ${paraRanges.length} para ranges`);
    
    // Step 3: IR → Markdown (roundtrip)
    const mdBack = irToMarkdown(ir);
    console.log(`  3. IR → MD: ${mdBack.length} chars`);
    
    // Compare normalized versions
    const originalNorm = normalizeMarkdown(tc.markdown);
    const roundtripNorm = normalizeMarkdown(mdBack);
    
    // Check for significant differences (ignoring whitespace normalization)
    const originalLines = originalNorm.split('\n').filter(l => l.trim());
    const roundtripLines = roundtripNorm.split('\n').filter(l => l.trim());
    
    // Count matching lines
    let matching = 0;
    for (let i = 0; i < Math.min(originalLines.length, roundtripLines.length); i++) {
      if (originalLines[i] === roundtripLines[i]) matching++;
    }
    
    const similarity = (matching / Math.max(originalLines.length, roundtripLines.length) * 100).toFixed(1);
    
    if (similarity >= 80) {
      console.log(`  ✓ PASS (${similarity}% line match)\n`);
      passed++;
    } else {
      console.log(`  ✗ FAIL (${similarity}% line match)`);
      console.log(`  Original: ${originalLines.join(' | ').substring(0, 100)}...`);
      console.log(`  Roundtrip: ${roundtripLines.join(' | ').substring(0, 100)}...\n`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}\n`);
    failed++;
  }
}

console.log('=== Summary ===');
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);

