### Google Docs Tabs: What the API Returns and Why It Looked Empty

#### Summary
- **Plain fetch (documents.get without includeTabsContent)**: `document.body.content` contains the visible text of the first tab. Use this for conversion to Markdown.
- **Tabs fetch (documents.get with includeTabsContent=true)**: moves content into `document.tabs` and typically leaves `document.body` empty. Use this only for tab detection/metadata.

#### What we observed (from scripts/inspect-tabs.cjs)
- Plain fetch summary showed non-zero paragraphs/runs and a valid text sample, e.g.:
  - paragraphs: 12, runs: 14, chars: 182
  - sample included "Document Title", "Document subtitle", headings, and body text.
- Tabs fetch reported:
  - `tabCount: 1`, with a tab titled `abcd1234`
  - For that tab, lengths at common locations were all zero:
    - `document.body.content: 0`
    - `body.content: 0`
    - `tab.body.content: 0`
    - `content: 0`

#### Why tab content looked empty with one tab
- The API behavior differs between single-tab and multi-tab documents:
  - With a single tab, the plain fetch keeps content in `document.body`. A tabs-aware response may include a `tabs` array for metadata, but not duplicate the same content into per-tab fields.
  - With multiple tabs, `includeTabsContent=true` populates `document.tabs` with per-tab content and leaves `document.body` empty.
- Therefore, when we switched to tabs fetch unconditionally, `document.body` became empty, and the converter produced empty Markdown.

#### Recommended approach for our sync
- **Conversion**: Always use the plain fetch for Markdown conversion (reliable `document.body.content`).
- **Tab detection**: Perform a second request with `includeTabsContent=true` and only read tab metadata (`tabs.length`, `tabProperties.tabId`, `tabProperties.title`). Do not feed the tabs response into the converter.
- **Multi-tab handling**: If `tabs.length > 1`, handle as a notebook mapping (one note per tab) in a guarded flow. For single-tab docs, proceed as a normal note pull.

#### Update: Unified content retrieval by tab (works for single- and multi-tab)
- With `includeTabsContent=true`, per-tab content lives at: `document.tabs[i].documentTab.body.content`.
- This is present for both single-tab and multi-tab documents.
- Therefore, a unified strategy is possible:
  1) Call `documents.get({ includeTabsContent: true })`.
  2) Select the tab you need (for single-tab, index 0).
  3) Read `documentTab.body.content` and convert that array.
- Note: In this mode, `document.body` is intentionally empty; always read from `document.tabs[].documentTab.body.content`.

##### Why we saw zeros earlier
- We initially probed the wrong fields (`tab.body.content`, `document.body.content`, `tab.tab.body.content`), which are empty when tabs mode is enabled.
- The correct field is `document.tabs[].documentTab.body.content`.

#### Test scripts
- Inspect summary (plain + tabs):
  - `node scripts/inspect-tabs.cjs --doc <DOCUMENT_ID>`
- Fetch content of a specific tab:
  - by index: `node scripts/fetch-tab-content.cjs --doc <DOCUMENT_ID> --tabIndex 1`
  - by title: `node scripts/fetch-tab-content.cjs --doc <DOCUMENT_ID> --tabTitle "My Tab"`
  - by id:    `node scripts/fetch-tab-content.cjs --doc <DOCUMENT_ID> --tabId t.abc123`

#### Run the inspector locally
```bash
# From repo root
node joplin-plugin-google-docs/google-api-tests/scripts/inspect-tabs.cjs --doc <DOCUMENT_ID>

# Or from the submodule directory
cd joplin-plugin-google-docs/google-api-tests
node scripts/inspect-tabs.cjs --doc <DOCUMENT_ID>
```
Requirements in `google-api-tests` directory:
- `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `.token.json` with OAuth tokens for that client


