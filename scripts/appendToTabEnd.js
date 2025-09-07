import 'dotenv/config';
import { google } from 'googleapis';

// Usage: npm run appendToTabEnd -- <documentId> <tabId> <text>
const [documentId, tabId, ...rest] = process.argv.slice(2);
if (!documentId || !tabId || rest.length === 0) {
  console.error('Usage: npm run appendToTabEnd -- <documentId> <tabId> <text>');
  process.exit(1);
}
const text = rest.join(' ');

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = (await import('fs')).readFileSync(tokensPath);
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(JSON.parse(tokens.toString()));
const docs = google.docs({ version: 'v1', auth });

const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const last = tabBody?.content?.[tabBody.content.length - 1];
const endIndex = last?.endIndex ?? 1;
const safeIndex = Math.max(1, endIndex - 1);

await docs.documents.batchUpdate({
  documentId,
  requestBody: {
    requests: [ { insertText: { location: { tabId, index: safeIndex }, text } } ],
  },
});
console.log('Appended to tab at index', endIndex);


