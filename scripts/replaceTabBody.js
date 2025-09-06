import 'dotenv/config';
import { google } from 'googleapis';
import { findNoteIdByFileId, updateSyncCheckpoint } from '../lib/mapping.js';
import fs from 'fs';

// Usage: npm run replaceTabBody -- <documentId> <tabId> <textFilePath>
const [documentId, tabId, filePath] = process.argv.slice(2);
if (!documentId || !tabId || !filePath) {
	console.error('Usage: npm run replaceTabBody -- <documentId> <tabId> <textFilePath>');
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

// Load full tab content to compute endIndex and revisionId
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;

const findTab = (tabs) => {
	const stack = [...(tabs || [])];
	while (stack.length) {
		const t = stack.shift();
		if (t.tabProperties?.tabId === tabId) return t;
		for (const c of t.childTabs || []) stack.push(c);
	}
	return null;
};

const tab = findTab(meta.data.tabs);
if (!tab) {
	console.error('Tab not found:', tabId);
	process.exit(2);
}

const body = tab.documentTab?.body;
if (!body?.content?.length) {
	console.error('Tab body not found.');
	process.exit(3);
}

// endIndex is on the last StructuralElement of the body
const last = body.content[body.content.length - 1];
const endIndex = last.endIndex ?? 1;

const requests = [];

// Delete all existing content in the tab body (except the final newline)
if (endIndex > 1) {
	requests.push({
		deleteContentRange: {
			range: { tabId, startIndex: 1, endIndex: endIndex - 1 },
		},
	});
}

// Insert new text at the start
requests.push({
	insertText: {
		location: { tabId, index: 1 },
		text: newText,
	},
});

const bodyReq = { requests, writeControl: { requiredRevisionId: revisionId } };

try {
	await docs.documents.batchUpdate({ documentId, requestBody: bodyReq });
	const meta2 = await docs.documents.get({ documentId });
	const noteId = findNoteIdByFileId(documentId);
	if (noteId) updateSyncCheckpoint(noteId, { lastKnownRevisionId: meta2.data.revisionId, lastSyncTs: new Date().toISOString() });
	console.log('OK: replaced body for tab', tabId);
} catch (err) {
	console.error('Replace failed:', err?.response?.data ?? err?.message ?? err);
	process.exit(4);
}


