/**
 * Auth helper for integration tests.
 * Reads tokens from .token.json and returns authenticated OAuth2 client.
 */
import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';

export function getAuth() {
  const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
  
  if (!fs.existsSync(tokensPath)) {
    console.error(`Token file not found: ${tokensPath}`);
    console.error('Run: npm run auth');
    process.exit(1);
  }
  
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(tokens);
  
  return auth;
}

export function getDocs(auth) {
  return google.docs({ version: 'v1', auth });
}

export function getDrive(auth) {
  return google.drive({ version: 'v3', auth });
}

export function getStorage(auth) {
  return google.storage({ version: 'v1', auth });
}

