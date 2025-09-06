import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

// Usage: npm run writeToTab -- <documentId> <tabId> <text>
const [documentId, tabId, ...rest] = process.argv.slice(2);
if (!documentId || !tabId || !rest.length) {
	console.error('Usage: npm run writeToTab -- <documentId> <tabId> <text>');
	process.exit(1);
}
const text = rest.join(' ');

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

// Get current revisionId for optimistic concurrency
const meta = await docs.documents.get({ documentId });
const revisionId = meta.data.revisionId;

const requests = [
	{
		insertText: {
			location: { tabId, index: 1 },
			text,
		},
	},
];

const body = {
	requests,
	writeControl: { requiredRevisionId: revisionId },
};

try {
	const res = await docs.documents.batchUpdate({ documentId, requestBody: body });
	console.log('OK: wrote to tab', tabId, 'newRevisionId:', res.data.writeControl?.requiredRevisionId ?? '(n/a)');
} catch (err) {
	console.error('Write failed:', err?.response?.data ?? err?.message ?? err);
	process.exit(2);
}


