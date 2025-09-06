import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

// Usage: npm run formatExplicit -- <documentId> <tabId> <textFilePath> <stylesCSV>
// stylesCSV example: H1,P,H2 (maps to HEADING_1, NORMAL_TEXT, HEADING_2)
const [documentId, tabId, filePath, stylesCsv] = process.argv.slice(2);
if (!documentId || !tabId || !filePath || !stylesCsv) {
	console.error('Usage: npm run formatExplicit -- <documentId> <tabId> <textFilePath> <stylesCSV>');
	process.exit(1);
}

const text = fs.readFileSync(filePath, 'utf8');
const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
const stylesInp = stylesCsv.split(',').map(s => s.trim().toUpperCase());
const styleMap = {
	'H1': 'HEADING_1',
	'H2': 'HEADING_2',
	'H3': 'HEADING_3',
	'P': 'NORMAL_TEXT',
	'NORMAL': 'NORMAL_TEXT',
};
const styles = stylesInp.map(s => styleMap[s] || 'NORMAL_TEXT');

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

// Get revision and clear tab content
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;
const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const last = tabBody?.content?.[tabBody.content.length - 1];
const endIndex = last?.endIndex ?? 1;

const reqs = [];
if (endIndex > 1) reqs.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
reqs.push({ insertText: { location: { tabId, index: 1 }, text } });

await docs.documents.batchUpdate({ documentId, requestBody: { requests: reqs, writeControl: { requiredRevisionId: revisionId } } });

// Apply paragraph styles per line
let cursor = 1; // start index after insert
const styleReqs = [];
for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	const len = line.length;
	const start = cursor;
	const end = start + len; // exclude newline
	const namedStyleType = styles[i] || 'NORMAL_TEXT';
	if (len >= 0) {
		styleReqs.push({
			updateParagraphStyle: {
				range: { tabId, startIndex: start, endIndex: end },
				paragraphStyle: { namedStyleType },
				fields: 'namedStyleType',
			},
		});
	}
	cursor = end + 1; // +1 for the newline
}

await docs.documents.batchUpdate({ documentId, requestBody: { requests: styleReqs } });

// Read back first few paragraph styles
const meta2 = await docs.documents.get({ documentId, includeTabsContent: true });
const tab2 = meta2.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const paras = (tab2?.content || [])
	.filter(se => se.paragraph)
	.slice(0, 6)
	.map((se, idx) => ({ idx, style: se.paragraph.paragraphStyle?.namedStyleType || 'UNKNOWN' }));
console.log('Paragraph styles (first 6):', paras);


