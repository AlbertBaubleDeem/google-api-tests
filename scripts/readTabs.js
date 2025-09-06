import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

const documentId = process.argv[2];
if (!documentId) {
	console.error('Usage: npm run readTabs -- <documentId>');
	process.exit(1);
}

const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });
const { data } = await docs.documents.get({ documentId, includeTabsContent: true });
const summarize = (tab) => ({
	id: tab.tabProperties?.tabId,
	title: tab.tabProperties?.title,
	children: (tab.childTabs || []).length,
});
console.log('tabs:', (data.tabs || []).map(summarize));
