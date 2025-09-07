import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { findNoteIdByFileId, getBinding, markAccessLost, updateSyncCheckpoint } from '../lib/mapping.js';
const mappingCfg = JSON.parse(fs.readFileSync(new URL('../config/md-mapping.json', import.meta.url)));

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
	const startRes = await drive.changes.getStartPageToken({ supportsAllDrives: true });
	const pageToken = startRes.data.startPageToken;
	saveState({ pageToken });
	console.log('Initialized pageToken:', pageToken, '(edits before this token will not appear)');
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

function extractParagraphs(tab) {
	const body = tab.documentTab?.body;
	if (!body?.content) return [];
	const paras = [];
	for (const el of body.content) {
		if (el.paragraph) {
			const runs = [];
			for (const se of el.paragraph.elements || []) {
				const t = se.textRun?.content || '';
				const ts = se.textRun?.textStyle || {};
				runs.push({ text: t, bold: !!ts.bold, italic: !!ts.italic });
			}
			const style = el.paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
			paras.push({ runs, style });
		}
	}
	return paras;
}

function runsToMarkdown(runs, inlineCfg) {
	const boldMarker = inlineCfg?.bold?.marker || '**';
	const italicMarker = inlineCfg?.italic?.marker || '*';
	let out = '';
	for (const r of runs) {
		let chunk = (r.text || '').replace(/\n+$/,'');
		if (!chunk) { out += (r.text || ''); continue; }
		if (r.bold && r.italic) {
			out += `${boldMarker}${italicMarker}${chunk}${italicMarker}${boldMarker}`;
		} else if (r.bold) {
			out += `${boldMarker}${chunk}${boldMarker}`;
		} else if (r.italic) {
			out += `${italicMarker}${chunk}${italicMarker}`;
		} else {
			out += chunk;
		}
		// Preserve original trailing newlines between runs if any
		const trailingNewlines = (r.text || '').match(/\n+$/);
		if (trailingNewlines) out += trailingNewlines[0];
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
			fields: 'newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name,appProperties,modifiedTime))',
			supportsAllDrives: true,
			includeItemsFromAllDrives: true,
		});
		if ((data.changes || []).length === 0) {
			// No changes in this page
		} else {
			console.log('Changes count:', data.changes.length, 'pageToken:', pageToken);
		}
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
			const paras = extractParagraphs(tab);
			const titlePara = paras.find(p => p.style === 'TITLE');
			const titleText = titlePara ? runsToMarkdown(titlePara.runs, mappingCfg.inline).replace(/\n+$/,'').trim() : '';
			const contentLines = [];
			if (titleText) contentLines.push(`# ${titleText}`);
			let usedSubtitle = false;
			for (const p of paras) {
				if (p === titlePara) continue;
				let line = runsToMarkdown(p.runs, mappingCfg.inline).replace(/\n+$/,'');
				// Map Docs Subtitle to italic line directly under title when configured
				if (!usedSubtitle && mappingCfg?.subtitle?.mode === 'italic' && p.style === 'SUBTITLE') {
					line = `_${line}_`;
					usedSubtitle = true;
				}
				contentLines.push(line);
			}
			const mdOut = contentLines.join('\n');
			const targetPath = path.join(localDir, `${noteId}.md`);
			fs.writeFileSync(targetPath, mdOut);
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


