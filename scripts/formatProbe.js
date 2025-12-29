import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

// Usage: npm run formatProbe -- <documentId> <tabId> <textFilePath> [preStyle]
// preStyle examples: NORMAL_TEXT, HEADING_1, HEADING_2, TITLE, SUBTITLE
const [documentId, tabId, filePath, preStyle] = process.argv.slice(2);
if (!documentId || !tabId || !filePath) {
	console.error('Usage: npm run formatProbe -- <documentId> <tabId> <textFilePath> [preStyle]');
	process.exit(1);
}

const newText = fs.readFileSync(filePath, 'utf8');

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

const findTab = (tabs) => {
	const stack = [...(tabs || [])];
	while (stack.length) {
		const t = stack.shift();
		if (t.tabProperties?.tabId === tabId) return t;
		for (const c of t.childTabs || []) stack.push(c);
	}
	return null;
};

// Load full tab content to compute indices and revisionId
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;
const tab = findTab(meta.data.tabs);
if (!tab) { console.error('Tab not found:', tabId); process.exit(2); }

const body = tab.documentTab?.body;
const first = body?.content?.[0];
const last = body?.content?.[body.content.length - 1];
const endIndex = last?.endIndex ?? 1;
const firstStart = first?.startIndex ?? 1;
const firstEnd = first?.endIndex ?? Math.min(10, endIndex);

const requests = [];

// Optionally set the first paragraph style before we replace content
if (preStyle) {
	requests.push({
		updateParagraphStyle: {
			range: { tabId, startIndex: firstStart, endIndex: firstEnd },
			paragraphStyle: { namedStyleType: preStyle },
			fields: 'namedStyleType',
		},
	});
}

// Delete all existing content in the tab body (except the final newline)
if (endIndex > 1) {
	requests.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
}

// Insert new text at the start
requests.push({ insertText: { location: { tabId, index: 1 }, text: newText } });

const bodyReq = { requests, writeControl: { requiredRevisionId: revisionId } };

await docs.documents.batchUpdate({ documentId, requestBody: bodyReq });

// Read back styles of the first few paragraphs to observe formatting
const meta2 = await docs.documents.get({ documentId, includeTabsContent: true });
const tab2 = findTab(meta2.data.tabs);
const paras = (tab2?.documentTab?.body?.content || [])
	.filter(se => se.paragraph)
	.slice(0, 6)
	.map((se, idx) => ({ idx, style: se.paragraph.paragraphStyle?.namedStyleType || 'UNKNOWN' }));

console.log('Paragraph styles (first 6):', paras);




