# google-api-tests

Minimal Node scripts for Drive/Docs tests.

## Roadmap & current baseline
- Baseline poller confirmed: Drive Changes API detects Doc edits and pulls target tab content into `local/{noteId}.md`.
- Mapping in `mapping.json` binds:
  - Notebook → Document (`bindNotebook`)
  - Note → Tab (`bindNote`)
- Writes use Docs optimistic concurrency via `writeControl.requiredRevisionId`.

## Scripts
- npm run auth: OAuth web flow to save tokens
- npm run startPageToken: print Drive startPageToken
- npm run listChanges: poll Drive changes (requires pageToken arg)
- npm run readTabs: documents.get with includeTabsContent=true
- npm run writeToTab -- <docId> <tabId> <text>: insert text into a tab (safe write)
- npm run replaceTabBody -- <docId> <tabId> <filePath>: replace a tab body (safe overwrite)
- npm run pullPush -- <docId> <tabId> <filePath>: pull→compare→push prototype
- npm run bindNotebook -- <notebookId> <docId>: bind a notebook to a Doc
- npm run bindNote -- <noteId> <docId> <tabId>: bind a note to a Tab
- npm run pullPushByNote -- <noteId> <filePath>: mapping-aware pull→push
- npm run pollChanges [--watch] [--interval=60]: baseline changes poller that writes to `local/{noteId}.md`
- npm run mdToDocs -- <docId> <tabId> <markdownFile>: convert minimal MD (H1–H3, bold, italic) to Docs using `config/md-mapping.json`

## Env
- See .env for variables

## Mechanisms & references
- OAuth scopes
  - drive.file (app-created/opened files)
  - drive.metadata.readonly (Changes API visibility)
  - documents (Docs read/write)
  - Reference: Google Identity OAuth 2.0
- Docs tabs: `documents.get(includeTabsContent=true)`, `Location.tabId`, tab tree traversal
  - Reference: Work with tabs — https://developers.google.com/workspace/docs/api/how-tos/tabs
- Optimistic concurrency: `documents.batchUpdate` with `writeControl.requiredRevisionId`
  - Reference: Docs API batchUpdate + writeControl
- Drive Changes API: `changes.getStartPageToken`, `changes.list`, `removed`, paging
  - Reference: Drive Changes API
- Mapping
  - Local: `mapping.json` stores note→{fileId, tabId, lastKnownRevisionId, lastSyncTs} and notebook→{fileId}
  - Planned: mirror noteId in Drive `appProperties` for robustness across move/rename
  - MD→Docs mapping: `config/md-mapping.json` (user-editable) governs headings and inline styling

## Next steps
- Integrate poller and write flows into plugin skeleton
- Add MD↔Docs conversion layer
