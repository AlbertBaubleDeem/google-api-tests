#!/usr/bin/env node
/*
  Fetch and print content of a specific Google Docs tab.

  Usage:
    node scripts/fetch-tab-content.cjs --doc <DOCUMENT_ID> [--tabId <TAB_ID> | --tabTitle <TITLE> | --tabIndex <N>] [--env <PATH_TO_.env>] [--token <PATH_TO_.token.json>]

  Notes:
    - Loads env (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI) and .token.json similarly to other tests
    - Uses documents.get(includeTabsContent=true), then reads tab.documentTab.body.content
*/

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--doc') out.doc = argv[++i];
    else if (a === '--tabId') out.tabId = argv[++i];
    else if (a === '--tabTitle') out.tabTitle = argv[++i];
    else if (a === '--tabIndex') out.tabIndex = parseInt(argv[++i], 10);
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--token') out.token = argv[++i];
  }
  return out;
}

function loadEnvFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch (_) {}
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function extractPlainTextFromBodyContent(contentArr) {
  if (!Array.isArray(contentArr)) return { paragraphs: 0, runs: 0, chars: 0, text: '' };
  let paragraphs = 0, runs = 0, chars = 0; let out = '';
  for (const c of contentArr) {
    const p = c && c.paragraph;
    if (!p || !Array.isArray(p.elements)) continue;
    paragraphs += 1;
    let line = '';
    for (const el of p.elements) {
      const tr = el && el.textRun;
      if (tr && typeof tr.content === 'string') {
        let s = tr.content
          .replace(/[\uE000-\uF8FF]/g, '')
          .replace(/\u000B/g, '\n')
          .replace(/\n+$/g, '');
        runs++; chars += s.length; line += s;
      }
    }
    if (line.length) out += (out ? '\n' : '') + line;
  }
  return { paragraphs, runs, chars, text: out };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.doc) {
    console.error('Missing --doc <DOCUMENT_ID>');
    process.exit(1);
  }
  const baseDir = path.resolve(__dirname, '..');
  const envPath = args.env || path.resolve(baseDir, '.env');
  const tokenPath = args.token || path.resolve(baseDir, '.token.json');

  loadEnvFile(envPath);
  const tokens = readJson(tokenPath);
  if (!tokens) { console.error('Missing or invalid token file:', tokenPath); process.exit(1); }
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.error('Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI in env:', envPath);
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  auth.setCredentials(tokens);
  const docs = google.docs({ version: 'v1', auth });

  try {
    const withTabs = await docs.documents.get({ documentId: args.doc, includeTabsContent: true });
    const tabs = (withTabs && withTabs.data && Array.isArray(withTabs.data.tabs)) ? withTabs.data.tabs : [];
    if (tabs.length === 0) {
      console.error('No tabs array returned. Is this a classic single-tab doc?');
      process.exit(2);
    }

    let picked = null; let pickedIndex = -1;
    if (args.tabId) {
      pickedIndex = tabs.findIndex(t => (t?.tabProperties?.tabId === args.tabId) || (t?.id === args.tabId));
    } else if (typeof args.tabIndex === 'number' && !Number.isNaN(args.tabIndex)) {
      pickedIndex = (args.tabIndex >= 0 && args.tabIndex < tabs.length) ? args.tabIndex : -1;
    } else if (args.tabTitle) {
      pickedIndex = tabs.findIndex(t => (t?.tabProperties?.title === args.tabTitle) || (t?.name === args.tabTitle) || (t?.title === args.tabTitle));
    } else if (tabs.length === 1) {
      pickedIndex = 0;
    }

    if (pickedIndex < 0) {
      console.error('Tab not found. Available tabs:');
      tabs.forEach((t, idx) => {
        console.error(`${idx}: id=${t?.tabProperties?.tabId || t?.id || '(none)'} title=${t?.tabProperties?.title || t?.name || t?.title || '(none)'}`);
      });
      process.exit(3);
    }
    picked = tabs[pickedIndex];

    const id = picked?.tabProperties?.tabId || picked?.id || String(pickedIndex);
    const title = picked?.tabProperties?.title || picked?.name || picked?.title || `Tab ${pickedIndex+1}`;
    const contentArr = picked?.documentTab?.body?.content
      || picked?.document?.body?.content
      || picked?.body?.content
      || picked?.tab?.body?.content
      || ([]);

    const plain = extractPlainTextFromBodyContent(contentArr);
    const output = {
      selectedTab: { index: pickedIndex, id, title },
      summary: { paragraphs: plain.paragraphs, runs: plain.runs, chars: plain.chars },
      sample: plain.text.slice(0, 1000),
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (e) {
    const raw = (e && e.response && e.response.data) || (e && e.message) || e;
    console.error('fetch-tab-content error:', typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
    process.exit(1);
  }
}

main();


