import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { findNoteIdByFileId, getBinding, markAccessLost, updateSyncCheckpoint } from '../lib/mapping.js';

// Usage: npm run pollChanges [--watch] [--interval=60]
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const intervalSecArg = args.find(a => a.startsWith('--interval='));
const intervalSec = intervalSecArg ? parseInt(intervalSecArg.split('=')[1], 10) : 60;

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });

const statePath = path.resolve(process.cwd(), 'changes.state.json');
const localDir = path.resolve(process.cwd(), 'local');
if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

function loadState() {
	try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
}
function saveState(s) {
	fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
}

async function initIfNeeded() {
	const st = loadState();
	if (st.pageToken) return st.pageToken;
	const { data } = await drive.changes.getStartPageToken({ supportsAllDrives: true });
	const pageToken = data.startPageToken;
	saveState({ pageToken });
	console.log('Initialized pageToken:', pageToken);
	return null; // indicate first-run init done
}

function extractTabText(tab) {
	const body = tab.documentTab?.body;
	if (!body?.content) return '';
	let out = '';
	for (const el of body.content) {
		for (const se of el.paragraph?.elements || []) out += se.textRun?.content || '';
	}
	return out;
}

function findTabById(doc, tabId) {
	const stack = [...(doc.tabs || [])];
	while (stack.length) {
		const t = stack.shift();
		if (t.tabProperties?.tabId === tabId) return t;
		for (const c of t.childTabs || []) stack.push(c);
	}
	return null;
}

async function processOnce() {
	const st = loadState();
	if (!st.pageToken) {
		// First run already handled by initIfNeeded()
		return;
	}
	let pageToken = st.pageToken;
	while (pageToken) {
		const { data } = await drive.changes.list({
			pageToken,
			fields: 'newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,appProperties,modifiedTime))',
		});
		for (const ch of data.changes || []) {
			const fileId = ch.fileId;
			const noteId = findNoteIdByFileId(fileId);
			if (!noteId) continue; // ignore unbound files
			if (ch.removed) {
				markAccessLost(noteId);
				console.log('Access lost for note', noteId, 'file', fileId);
				continue;
			}
			const binding = getBinding(noteId);
			if (!binding || !binding.tabId) continue;
			// Pull doc and write local shadow file
			const meta = await docs.documents.get({ documentId: fileId, includeTabsContent: true });
			const tab = findTabById(meta.data, binding.tabId);
			if (!tab) continue;
			const text = extractTabText(tab);
			const targetPath = path.join(localDir, `${noteId}.md`);
			fs.writeFileSync(targetPath, text);
			updateSyncCheckpoint(noteId, { lastKnownRevisionId: meta.data.revisionId, lastSyncTs: new Date().toISOString() });
			console.log('Pulled update for note', noteId, '->', targetPath);
		}
		if (data.nextPageToken) {
			pageToken = data.nextPageToken;
		} else {
			// Save newStartPageToken if provided, else keep current
			const newToken = data.newStartPageToken || pageToken;
			saveState({ pageToken: newToken });
			break;
		}
	}
}

async function main() {
	const maybeToken = await initIfNeeded();
	if (maybeToken === null && !watch) return; // first init only
	if (!watch) {
		await processOnce();
		return;
	}
	// watch loop
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try { await processOnce(); } catch (e) { console.error('Poll error:', e?.response?.data || e?.message || e); }
		await new Promise(r => setTimeout(r, Math.max(5, intervalSec) * 1000));
	}
}

main();


