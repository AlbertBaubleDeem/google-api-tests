# google-api-tests

Minimal Node scripts for Drive/Docs tests.

## Scripts
- npm run auth: OAuth web flow to save tokens
- npm run startPageToken: print Drive startPageToken
- npm run listChanges: poll Drive changes (requires pageToken arg)
- npm run readTabs: documents.get with includeTabsContent=true

## Env
- See .env for variables
