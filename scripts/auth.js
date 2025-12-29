import 'dotenv/config';
import http from 'http';
import open from 'open';
import fs from 'fs';
import { google } from 'googleapis';

const {
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth2callback',
	GOOGLE_TOKENS_PATH = '.token.json',
} = process.env;

const oauth2Client = new google.auth.OAuth2(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GOOGLE_REDIRECT_URI,
);

const scopes = [
	'https://www.googleapis.com/auth/drive.file',
	'https://www.googleapis.com/auth/drive',  // Added for sharing permissions
	'https://www.googleapis.com/auth/documents',
];

const url = oauth2Client.generateAuthUrl({
	access_type: 'offline',
	prompt: 'consent',
	scope: scopes,
});

const server = http
	.createServer(async (req, res) => {
		try {
			if (!req.url || !req.url.startsWith('/oauth2callback')) {
				res.end('Expected /oauth2callback');
				return;
			}
			const code = new URL(req.url, 'http://localhost:3000').searchParams.get('code');
			const { tokens } = await oauth2Client.getToken(code ?? '');
			fs.writeFileSync(GOOGLE_TOKENS_PATH, JSON.stringify(tokens, null, 2));
			res.end(`Tokens saved to ${GOOGLE_TOKENS_PATH}; you can close this.`);
			server.close();
		} catch (err) {
			console.error(err);
			res.statusCode = 500;
			res.end('Auth error');
			server.close();
		}
	})
	.listen(3000, () => {
		console.log('Listening on http://localhost:3000, opening browser...');
	});

await open(url);


