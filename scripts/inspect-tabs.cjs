#!/usr/bin/env node
/*
  Inspect Google Docs tabs safely, without affecting the plugin.
  - Makes two requests:
    1) Plain documents.get (reliable body.content)
    2) documents.get with includeTabsContent=true (for tab detection)

  Usage:
    node scripts/inspect-tabs.cjs --doc <DOCUMENT_ID> [--env <PATH_TO_.env>] [--token <PATH_TO_.token.json>]

  Expected env vars (from .env):
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
*/

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--doc') out.doc = argv[++i];
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
  if (!tokens) {
    console.error('Missing or invalid token file:', tokenPath);
    process.exit(1);
  }
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.error('Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI in env:', envPath);
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  auth.setCredentials(tokens);
  const docs = google.docs({ version: 'v1', auth });

  try {
    // 1) Plain fetch for conversion baseline
    const plain = await docs.documents.get({ documentId: args.doc });
    const body = (plain.data && plain.data.body && Array.isArray(plain.data.body.content)) ? plain.data.body.content : [];
    let paras = 0, runs = 0, chars = 0, sample = '';
    for (const c of body) {
      const p = c && c.paragraph;
      if (!p || !Array.isArray(p.elements)) continue;
      paras += 1;
      for (const el of p.elements) {
        const tr = el && el.textRun;
        if (tr && typeof tr.content === 'string') {
          const s = tr.content.replace(/[\uE000-\uF8FF]/g, '').replace(/\u000B/g, '\n');
          runs++; chars += s.length; if (sample.length < 256) sample += s;
        }
      }
    }

    // 2) Tabs fetch for tab detection only
    let tabCount = 0; const tabSummaries = [];
    try {
      const withTabs = await docs.documents.get({ documentId: args.doc, includeTabsContent: true });
      const tabs = (withTabs && withTabs.data && Array.isArray(withTabs.data.tabs)) ? withTabs.data.tabs : [];
      tabCount = tabs.length;
      tabs.forEach((t, idx) => {
        const id = t?.tabProperties?.tabId || t?.id || String(idx);
        const title = t?.tabProperties?.title || t?.name || t?.title || `Tab ${idx+1}`;
        const lenDocumentTabBody = Array.isArray(t?.documentTab?.body?.content) ? t.documentTab.body.content.length : 0;
        const lenDocBody = Array.isArray(t?.document?.body?.content) ? t.document.body.content.length : 0;
        const lenBody = Array.isArray(t?.body?.content) ? t.body.content.length : 0;
        const lenTabBody = Array.isArray(t?.tab?.body?.content) ? t.tab.body.content.length : 0;
        const lenContent = Array.isArray(t?.content) ? t.content.length : 0;
        const childCount = Array.isArray(t?.childTabs) ? t.childTabs.length : 0;
        tabSummaries.push({ id, title, lengths: { documentTabBody: lenDocumentTabBody, documentBody: lenDocBody, body: lenBody, tabBody: lenTabBody, content: lenContent }, childTabs: childCount });
      });
    } catch (e) {
      // ignore tabs errors, report message
      tabSummaries.push({ error: (e && e.message) || String(e) });
    }

    const output = {
      plainSummary: { paragraphs: paras, runs, chars, sample },
      tabSummary: { tabCount, tabs: tabSummaries },
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (e) {
    const raw = (e && e.response && e.response.data) || (e && e.message) || e;
    console.error('inspect-tabs error:', typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
    process.exit(1);
  }
}

main();


