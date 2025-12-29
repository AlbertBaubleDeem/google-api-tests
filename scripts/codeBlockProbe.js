import 'dotenv/config';
import { google } from 'googleapis';

// Usage: npm run codeBlockProbe -- <documentId> <tabId>
const [documentId, tabId] = process.argv.slice(2);
if (!documentId || !tabId) {
  console.error('Usage: npm run codeBlockProbe -- <documentId> <tabId>');
  process.exit(1);
}

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = (await import('fs')).readFileSync(tokensPath);
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(JSON.parse(tokens.toString()));
const docs = google.docs({ version: 'v1', auth });

// Clear tab, then try UI-like trigger: insert ``` + newline, then code text
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;
const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const last = tabBody?.content?.[tabBody.content.length - 1];
const endIndex = last?.endIndex ?? 1;

const phase1 = [];
if (endIndex > 1) phase1.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
phase1.push({ insertText: { location: { tabId, index: 1 }, text: '```\n' } });
await docs.documents.batchUpdate({ documentId, requestBody: { requests: phase1, writeControl: { requiredRevisionId: revisionId } } });

// Phase 2: insert code content and a trailing blank line
const meta2 = await docs.documents.get({ documentId, includeTabsContent: true });
const afterInsert = meta2.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const afterLast = afterInsert?.content?.[afterInsert.content.length - 1];
const afterEnd = afterLast?.endIndex ?? 1;
const codeText = "console.log('probe');\n";
await docs.documents.batchUpdate({ documentId, requestBody: { requests: [ { insertText: { location: { tabId, index: afterEnd }, text: codeText } } ] } });

// Read back and inspect paragraph styles (shading/border/monospace)
const meta3 = await docs.documents.get({ documentId, includeTabsContent: true });
const tab = meta3.data.tabs?.find(t => t.tabProperties?.tabId === tabId);
const pars = [];
for (const el of tab?.documentTab?.body?.content || []) {
  if (el.paragraph) {
    const ps = el.paragraph.paragraphStyle || {};
    const runFonts = (el.paragraph.elements || []).map(se => se.textRun?.textStyle?.weightedFontFamily?.fontFamily).filter(Boolean);
    pars.push({
      namedStyleType: ps.namedStyleType,
      shading: ps.shading?.backgroundColor ? 'yes' : 'no',
      borderLeft: !!ps.borderLeft,
      monoRun: runFonts.some(f => /mono|courier/i.test(f || '')),
      text: (el.paragraph.elements || []).map(se => se.textRun?.content || '').join(''),
    });
  }
}
console.log('Paragraphs summary:', pars.slice(0, 6));




