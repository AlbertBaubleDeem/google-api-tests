import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

// Usage: node scripts/inspectCodeBlock.js <documentId>
const [documentId] = process.argv.slice(2);
if (!documentId) {
  console.error('Usage: node scripts/inspectCodeBlock.js <documentId>');
  process.exit(1);
}

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = fs.readFileSync(tokensPath);
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(JSON.parse(tokens.toString()));
const docs = google.docs({ version: 'v1', auth });

// Fetch document
const res = await docs.documents.get({ documentId });
const body = res.data.body?.content || [];

console.log('\n=== Document Structure ===\n');

for (let i = 0; i < body.length; i++) {
  const el = body[i];
  if (el.paragraph) {
    const p = el.paragraph;
    const ps = p.paragraphStyle || {};
    const bullet = p.bullet;
    
    // Collect text content
    const textContent = (p.elements || [])
      .map(e => e.textRun?.content || '[inline object]')
      .join('')
      .replace(/\n/g, '\\n');
    
    // Collect font info from runs
    const fonts = (p.elements || [])
      .map(e => e.textRun?.textStyle?.weightedFontFamily?.fontFamily)
      .filter(Boolean);
    
    // Collect all text styles
    const textStyles = (p.elements || [])
      .map(e => e.textRun?.textStyle)
      .filter(Boolean);
    
    console.log(`--- Paragraph ${i} ---`);
    console.log(`  Text: "${textContent.substring(0, 60)}${textContent.length > 60 ? '...' : ''}"`);
    console.log(`  namedStyleType: ${ps.namedStyleType || 'none'}`);
    console.log(`  shading: ${ps.shading ? JSON.stringify(ps.shading) : 'none'}`);
    console.log(`  borderLeft: ${ps.borderLeft ? 'yes' : 'no'}`);
    console.log(`  indentStart: ${ps.indentStart?.magnitude || 0}`);
    console.log(`  bullet: ${bullet ? JSON.stringify(bullet) : 'none'}`);
    console.log(`  fonts: ${fonts.length > 0 ? fonts.join(', ') : 'default'}`);
    
    // Show EACH run's content and font for debugging
    console.log(`  --- Runs (${(p.elements || []).length} total) ---`);
    for (let r = 0; r < (p.elements || []).length; r++) {
      const run = p.elements[r];
      if (run.textRun) {
        const runContent = (run.textRun.content || '').substring(0, 20).replace(/\n/g, '\\n');
        const runFont = run.textRun.textStyle?.weightedFontFamily?.fontFamily || 'EMPTY';
        const hasWeighted = run.textRun.textStyle?.weightedFontFamily ? 'hasWF' : 'noWF';
        console.log(`    [${r}] "${runContent}" => font="${runFont}" (${hasWeighted})`);
      }
    }
    
    // Show full textStyle for first element if interesting
    if (textStyles.length > 0) {
      const ts = textStyles[0];
      const interesting = ts.bold || ts.italic || ts.link || ts.backgroundColor || ts.foregroundColor;
      if (interesting || Object.keys(ts).length > 1) {
        console.log(`  textStyle[0]: ${JSON.stringify(ts)}`);
      }
    }
    console.log('');
  }
}

console.log('=== Raw paragraphStyle dump for first 5 paragraphs ===\n');
for (let i = 0; i < Math.min(5, body.length); i++) {
  if (body[i].paragraph) {
    console.log(`Para ${i}:`, JSON.stringify(body[i].paragraph.paragraphStyle, null, 2));
  }
}
