import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

// Usage: npm run mdToDocs -- <documentId> <tabId> <markdownFile>
const [documentId, tabId, mdPath] = process.argv.slice(2);
if (!documentId || !tabId || !mdPath) {
	console.error('Usage: npm run mdToDocs -- <documentId> <tabId> <markdownFile>');
	process.exit(1);
}

const md = fs.readFileSync(mdPath, 'utf8');

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));
const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);
const docs = google.docs({ version: 'v1', auth });

// Load mapping config (user-editable)
let mapping = null;
try {
    mapping = JSON.parse(fs.readFileSync(new URL('../config/md-mapping.json', import.meta.url)));
} catch {
    mapping = { headings: { h1: 'HEADING_1', h2: 'HEADING_2', h3: 'HEADING_3', default: 'NORMAL_TEXT' } };
}

// Parse headings and inline bold/italic, generating plain text and style ranges
const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

function paragraphStyleFor(line) {
    const h = mapping.headings || {};
    if (/^#\s+/.test(line)) return h.h1 || 'HEADING_1';
    if (/^##\s+/.test(line)) return h.h2 || 'HEADING_2';
    if (/^###\s+/.test(line)) return h.h3 || 'HEADING_3';
    return h.default || 'NORMAL_TEXT';
}

function stripHeadingMarkers(line) {
	return line.replace(/^#{1,6}\s+/, '');
}

// Build plain text and collect paragraph style + inline style ranges
let plain = '';
const paraRanges = []; // { start, end, style }
const textRanges = []; // { start, end, bold?, italic? }
let cursor = 0;

for (let i = 0; i < lines.length; i++) {
	const original = lines[i];
	const namedStyleType = paragraphStyleFor(original);
	let line = stripHeadingMarkers(original);
	// Inline: bold **text** and italic *text* or _text_
	// Simple non-nested handling
	const applyInline = (re, updater) => {
		let m;
		let offset = 0;
		while ((m = re.exec(line)) !== null) {
			const full = m[0];
			const inner = m[1];
			const startInLine = m.index - offset; // after removing markers
			const endInLine = startInLine + inner.length;
			updater(cursor + startInLine, cursor + endInLine);
			// Replace match in line with inner (remove markers) and adjust offset
			line = line.slice(0, m.index) + inner + line.slice(m.index + full.length);
			offset += full.length - inner.length;
			re.lastIndex = m.index + inner.length; // continue after replaced segment
		}
	};
	applyInline(/\*\*([^*]+)\*\*/g, (s, e) => textRanges.push({ start: s, end: e, bold: true }));
	applyInline(/\*([^*]+)\*/g, (s, e) => textRanges.push({ start: s, end: e, italic: true }));
	applyInline(/_([^_]+)_/g, (s, e) => textRanges.push({ start: s, end: e, italic: true }));

	const start = cursor;
	plain += line + '\n';
	const end = start + line.length; // exclude newline
	paraRanges.push({ start, end, style: namedStyleType });
	cursor = end + 1;
}

// Fetch revision and clear target tab content, insert plain text, then apply styles
const meta = await docs.documents.get({ documentId, includeTabsContent: true });
const revisionId = meta.data.revisionId;
const tabBody = meta.data.tabs?.find(t => t.tabProperties?.tabId === tabId)?.documentTab?.body;
const last = tabBody?.content?.[tabBody.content.length - 1];
const endIndex = last?.endIndex ?? 1;

const reqs = [];
if (endIndex > 1) reqs.push({ deleteContentRange: { range: { tabId, startIndex: 1, endIndex: endIndex - 1 } } });
reqs.push({ insertText: { location: { tabId, index: 1 }, text: plain } });
await docs.documents.batchUpdate({ documentId, requestBody: { requests: reqs, writeControl: { requiredRevisionId: revisionId } } });

// Apply paragraph styles
const paraReqs = paraRanges
	.filter(r => r.end >= r.start)
	.map(r => ({
		updateParagraphStyle: {
			range: { tabId, startIndex: r.start + 1, endIndex: r.end + 1 }, // +1 due to insertion starting at index 1
			paragraphStyle: { namedStyleType: r.style },
			fields: 'namedStyleType',
		},
	}))
;
// Apply text styles
const textReqs = textRanges.map(r => ({
	updateTextStyle: {
		range: { tabId, startIndex: r.start + 1, endIndex: r.end + 1 },
		textStyle: { bold: !!r.bold, italic: !!r.italic },
		fields: [r.bold ? 'bold' : null, r.italic ? 'italic' : null].filter(Boolean).join(','),
	},
}));

const allStyleReqs = [...paraReqs, ...textReqs];
if (allStyleReqs.length) await docs.documents.batchUpdate({ documentId, requestBody: { requests: allStyleReqs } });

console.log('Applied md→Docs styles. Paragraphs:', paraRanges.length, 'Text ranges:', textRanges.length);


