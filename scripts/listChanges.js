import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

const pageToken = process.argv[2];
if (!pageToken) {
	console.error('Usage: npm run listChanges -- <pageToken>');
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

const drive = google.drive({ version: 'v3', auth });
const { data } = await drive.changes.list({
	pageToken,
	fields:
		'newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,appProperties,modifiedTime,parents))',
});
console.log(JSON.stringify(data, null, 2));
