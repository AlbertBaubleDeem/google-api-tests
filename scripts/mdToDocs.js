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

let inFence = false;
let fenceLang = '';

for (let i = 0; i < lines.length; i++) {
	const original = lines[i];
	// Fenced code block toggle
	const fenceMatch = original.match(/^```\s*([a-zA-Z0-9_-]+)?\s*$/);
	if (fenceMatch) {
		inFence = !inFence;
		fenceLang = inFence ? (fenceMatch[1] || '') : '';
		continue; // do not emit the backtick line itself
	}

	const namedStyleType = inFence ? 'CODEBLOCK' : paragraphStyleFor(original);
	let line = inFence ? original : stripHeadingMarkers(original);
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

// Enforce first line as Docs Title when configured
if (mapping?.title?.useTitle && paraRanges.length > 0) {
	paraRanges[0].style = 'TITLE';
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

// Apply paragraph styles (first line enforced to TITLE; if second line is italic and mapping.subtitle.mode=italic, set SUBTITLE)
if (mapping?.title?.useTitle && paraRanges.length > 0) {
    paraRanges[0].style = 'TITLE';
}
if (mapping?.subtitle?.mode === 'italic' && paraRanges.length > 1) {
    // Detect italic via textRanges that fully cover the second line
    const second = paraRanges[1];
    const fullItalic = textRanges.some(r => r.italic && r.start <= second.start && r.end >= second.end);
    if (fullItalic) paraRanges[1].style = 'SUBTITLE';
}

// Apply paragraph styles
const paraReqs = paraRanges
	.filter(r => r.end >= r.start)
	.map(r => ({
		updateParagraphStyle: {
			range: { tabId, startIndex: r.start + 1, endIndex: r.end + 1 }, // +1 due to insertion starting at index 1
			paragraphStyle: r.style === 'CODEBLOCK'
				? {
					shading: { backgroundColor: { color: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } } } },
					borderLeft: {
						width: { magnitude: 1, unit: 'PT' },
						padding: { magnitude: 6, unit: 'PT' },
						color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
						dashStyle: 'SOLID',
					},
				}
				: { namedStyleType: r.style },
			fields: r.style === 'CODEBLOCK'
				? 'shading,borderLeft'
				: 'namedStyleType',
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

// Enforce monospace font for CODEBLOCK paragraphs
const codeMonoReqs = paraRanges
	.filter(r => r.style === 'CODEBLOCK')
	.map(r => ({
		updateTextStyle: {
			range: { tabId, startIndex: r.start + 1, endIndex: r.end + 1 },
			textStyle: { weightedFontFamily: { fontFamily: 'Roboto Mono' } },
			fields: 'weightedFontFamily',
		},
	}));

const allStyleReqs = [...paraReqs, ...textReqs, ...codeMonoReqs];
if (allStyleReqs.length) await docs.documents.batchUpdate({ documentId, requestBody: { requests: allStyleReqs } });

console.log('Applied md→Docs styles. Paragraphs:', paraRanges.length, 'Text ranges:', textRanges.length);


