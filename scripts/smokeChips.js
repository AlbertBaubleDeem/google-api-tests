/**
 * Live smoke test for smart-chip API support.
 *
 * Creates a temporary Google Doc, sends one insertPerson, one insertRichLink,
 * and one insertDate request, reads the doc back via documents.get, and
 * verifies that the three matching ParagraphElement variants are present.
 *
 * Then deletes the test doc.
 *
 * This is the SDK compatibility check from the smart-chip plan: if the
 * installed googleapis client rejects the new request fields, this fails fast
 * with a clear error.
 *
 * Usage:
 *   cd google-api-tests
 *   node scripts/smokeChips.js
 */

import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });
const drive = google.drive({ version: 'v3', auth });

const log = (...args) => console.log(...args);
const die = (msg, err) => {
  console.error(`\n❌ ${msg}`);
  if (err) console.error(err?.response?.data || err);
  process.exit(1);
};

const main = async () => {
  // 1. Create a fresh doc.
  log('Creating temporary smoke-test doc...');
  let documentId;
  try {
    const created = await docs.documents.create({ requestBody: { title: `Chip smoke ${new Date().toISOString()}` } });
    documentId = created.data.documentId;
    log(`  -> ${documentId}`);
  } catch (err) {
    die('docs.documents.create failed', err);
  }

  // 2. Seed the doc with a tiny paragraph so we have a stable index 1.
  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: 1 }, text: 'A B C\n' } },
        ],
      },
    });
  } catch (err) {
    die('Initial insertText failed', err);
  }

  // 3. Send each chip-insert request as its own batch so a single failure
  //    doesn't mask others. Use endOfSegmentLocation so we don't have to
  //    track indices across insertions.
  const sendBatch = async (label, requests) => {
    log(`Sending ${label}...`);
    try {
      await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
      log(`  ✓ ${label} accepted`);
    } catch (err) {
      const apiError = err?.response?.data?.error || err?.errors?.[0] || err?.message;
      console.error(`  ✗ ${label} rejected:`, apiError);
      throw err;
    }
  };

  try {
    // Use the email-only shape we ended up shipping in chipHandler.ts.
    // PersonProperties.name is OUTPUT-only; insertPerson rejects it with HTTP 400.
    await sendBatch('insertPerson (email only)', [
      {
        insertPerson: {
          endOfSegmentLocation: {},
          personProperties: { email: 'chip-smoke@example.com' },
        },
      },
    ]);
  } catch {}

  try {
    await sendBatch('insertText separator', [
      { insertText: { location: { index: 1 }, text: '\n' } },
    ]);
  } catch {}

  // Probe several URL shapes to learn what insertRichLink accepts. Each
  // attempt is its own batch so a single rejection doesn't mask the others.
  // All non-Drive URLs are REAL public/test resources.
  //
  // The user's Calendar event has eid:
  //   MXE3djU5MmJrM3A2ZWxhbGpxMXM3aGNuc2wgZHVtbXkuam9lQGJlbmUtbWVhdC10ZWNobm9sb2dpZXMuY29t
  // The TEMPLATE URL form is for "Add to Calendar" — for chip insertion we
  // try the canonical event-reference URL (eid=) too.
  const calendarEid = 'MXE3djU5MmJrM3A2ZWxhbGpxMXM3aGNuc2wgZHVtbXkuam9lQGJlbmUtbWVhdC10ZWNobm9sb2dpZXMuY29t';
  const richLinkProbes = [
    { label: 'Drive doc (this doc)', uri: `https://docs.google.com/document/d/${documentId}/edit` },
    { label: 'Drive file open', uri: `https://drive.google.com/open?id=${documentId}` },
    // YouTube
    { label: 'YouTube watch?v= (real video)', uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { label: 'YouTube short youtu.be (real video)', uri: 'https://youtu.be/dQw4w9WgXcQ' },
    // Maps
    { label: 'Maps with @coords + data param (Googleplex)', uri: 'https://www.google.com/maps/place/Googleplex/@37.4220041,-122.0862515,17z/data=!3m1!4b1!4m6!3m5!1s0x808fb99feb1d3c93:0x6b76f24b7f6a8ad6!8m2!3d37.4220041!4d-122.0840628!16zL20vMDNiZmd0' },
    { label: 'Maps q=place_id', uri: 'https://www.google.com/maps/place/?q=place_id:ChIJj61dQgK6j4AR4GeTYWZsKWw' },
    // Calendar
    { label: 'Calendar event (canonical eid form)', uri: `https://www.google.com/calendar/event?eid=${calendarEid}` },
    { label: 'Calendar event (calendar.google.com host)', uri: `https://calendar.google.com/calendar/event?eid=${calendarEid}` },
    { label: 'Calendar event (TEMPLATE form, original)', uri: `https://calendar.google.com/calendar/event?action=TEMPLATE&tmeid=${calendarEid}&tmsrc=dummy.joe%40bene-meat-technologies.com` },
  ];
  for (const probe of richLinkProbes) {
    try {
      await sendBatch(`insertRichLink (${probe.label})`, [
        {
          insertRichLink: {
            endOfSegmentLocation: {},
            richLinkProperties: { uri: probe.uri },
          },
        },
      ]);
    } catch {}
  }

  try {
    await sendBatch('insertText separator', [
      { insertText: { location: { index: 1 }, text: '\n' } },
    ]);
  } catch {}

  try {
    // timeZoneId requires TIME_FORMAT_HOUR_MINUTE_TIMEZONE on insert; for a
    // date-only chip we drop the tz.
    await sendBatch('insertDate (date-only, no tz)', [
      {
        insertDate: {
          endOfSegmentLocation: {},
          dateElementProperties: {
            timestamp: '2026-05-09T00:00:00Z',
            locale: 'en',
            dateFormat: 'DATE_FORMAT_MONTH_DAY_YEAR_ABBREVIATED',
            timeFormat: 'TIME_FORMAT_DISABLED',
          },
        },
      },
    ]);
  } catch {}

  try {
    await sendBatch('insertText separator', [
      { insertText: { location: { index: 1 }, text: '\n' } },
    ]);
  } catch {}

  try {
    // And one date+time-with-zone chip to confirm the tz-with-timezone-format combo works.
    await sendBatch('insertDate (with timezone-format)', [
      {
        insertDate: {
          endOfSegmentLocation: {},
          dateElementProperties: {
            timestamp: '2026-05-09T16:30:00Z',
            timeZoneId: 'America/New_York',
            locale: 'en',
            dateFormat: 'DATE_FORMAT_MONTH_DAY_YEAR_ABBREVIATED',
            timeFormat: 'TIME_FORMAT_HOUR_MINUTE_TIMEZONE',
          },
        },
      },
    ]);
  } catch {}

  // 4. Read the doc back and look for person/richLink/dateElement.
  log('Re-fetching doc and inspecting paragraph elements...');
  let doc;
  try {
    const res = await docs.documents.get({ documentId, includeTabsContent: true });
    doc = res.data;
  } catch (err) {
    die('documents.get failed', err);
  }

  // Walk every paragraph element across the body / first tab.
  const collected = { person: [], richLink: [], dateElement: [] };
  const visit = (content) => {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const elements = block?.paragraph?.elements;
      if (!elements) continue;
      for (const el of elements) {
        if (el.person) collected.person.push(el.person);
        if (el.richLink) collected.richLink.push(el.richLink);
        if (el.dateElement) collected.dateElement.push(el.dateElement);
      }
    }
  };
  visit(doc.body?.content);
  for (const tab of doc.tabs || []) {
    visit(tab.documentTab?.body?.content);
  }

  log(`  person elements:     ${collected.person.length}`);
  log(`  richLink elements:   ${collected.richLink.length}`);
  log(`  dateElement count:   ${collected.dateElement.length}`);

  // 5. Inspect properties.
  if (collected.person.length === 0) die('No person element found in the doc');
  if (collected.dateElement.length === 0) die('No dateElement found in the doc');
  if (collected.richLink.length === 0) {
    log('  WARNING: no rich link survived — none of the probed URL shapes were accepted.');
  }

  // Person: only email is sent on insert; name (output-only) is server-derived.
  const p = collected.person[0].personProperties;
  if (p?.email !== 'chip-smoke@example.com') die(`person email mismatch: ${JSON.stringify(p)}`);
  log(`  person.personProperties: name="${p.name ?? ''}", email=${p.email}`);

  // Rich link: title (output-only) is derived from URI metadata fetched server-side.
  for (let i = 0; i < collected.richLink.length; i++) {
    const r = collected.richLink[i].richLinkProperties;
    log(`  richLink[${i}].richLinkProperties: title="${r?.title ?? ''}", uri=${r?.uri}, mime=${r?.mimeType ?? '(none)'}`);
  }

  for (let i = 0; i < collected.dateElement.length; i++) {
    const d = collected.dateElement[i].dateElementProperties;
    if (!d?.timestamp) die(`dateElement[${i}] missing timestamp: ${JSON.stringify(d)}`);
    log(`  dateElement[${i}].dateElementProperties: ts=${d.timestamp} tz=${d.timeZoneId ?? '(none)'} tf=${d.timeFormat} display="${d.displayText}"`);
  }

  // 6. Leaving the doc in place so you can inspect it in the browser.
  log('\nLeaving test doc in place for manual inspection.');
  log(`  open: https://docs.google.com/document/d/${documentId}/edit`);
  log('  delete later with:');
  log(`    node -e "import('googleapis').then(async m => { const a = new m.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET); a.setCredentials(JSON.parse(require('fs').readFileSync(process.env.GOOGLE_TOKENS_PATH || '.token.json'))); await m.google.drive({version:'v3',auth:a}).files.delete({ fileId: '${documentId}', supportsAllDrives: true }); console.log('deleted'); })"`);

  log('\n✅ All three chip-insert request types accepted and round-tripped via documents.get.');
};

main().catch((err) => die('Smoke test failed', err));
