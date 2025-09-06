import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import { getBinding } from '../lib/mapping.js';

// Usage: npm run pullPushByNote -- <noteId> <localPath>
const [noteId, localPath] = process.argv.slice(2);
if (!noteId || !localPath) {
	console.error('Usage: npm run pullPushByNote -- <noteId> <localPath>');
	process.exit(1);
}

const binding = getBinding(noteId);
if (!binding) {
	console.error('No binding for noteId:', noteId);
	process.exit(2);
}
const { fileId: documentId, tabId } = binding;

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });

const getTabText = (tab) => {
	const body = tab.documentTab?.body;
	if (!body?.content) return '';
	let out = '';
	for (const el of body.content) {
		for (const se of el.paragraph?.elements || []) {
			out += se.textRun?.content || '';
		}
	}
	return out;
};

const findTab = (tabs) => {
	const stack = [...(tabs || [])];
	while (stack.length) {
		const t = stack.shift();
		if (t.tabProperties?.tabId === tabId) return t;
		for (const c of t.childTabs || []) stack.push(c);
	}
	return null;
};

// Pull
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;
const tab = findTab(meta.data.tabs);
if (!tab) {
	console.error('Tab not found for binding:', tabId);
	process.exit(3);
}
const remoteText = getTabText(tab);

// Compare
const localText = fs.readFileSync(localPath, 'utf8');
if (remoteText === localText) {
	console.log('No diff: skip push.');
	process.exit(0);
}

// Compute endIndex for replace
const body = tab.documentTab?.body;
const last = body.content[body.content.length - 1];
const endIndex = last.endIndex ?? 1;

const requests = [];
if (endIndex > 1) {
	requests.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
}
requests.push({ insertText: { location: { tabId, index: 1 }, text: localText } });

// Push
try {
	await docs.documents.batchUpdate({ documentId, requestBody: { requests, writeControl: { requiredRevisionId: revisionId } } });
	console.log('Pushed new content to note', noteId, 'tab', tabId);
} catch (err) {
	console.error('Push failed (possible conflict):', err?.response?.data ?? err?.message ?? err);
	process.exit(4);
}


