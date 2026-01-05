/**
 * Inspect folder and its app properties
 * 
 * Usage: node scripts/inspectFolder.js
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || '';
const WRONG_FOLDER_ID = process.env.WRONG_FOLDER_ID || '';

// Auth setup
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = fs.readFileSync(tokensPath);
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(JSON.parse(tokens.toString()));
const drive = google.drive({ version: 'v3', auth });

async function inspectFolder(folderId, label = '') {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,parents,appProperties',
      supportsAllDrives: true,
    });
    
    console.log(`\n=== ${label || 'Folder'}: ${response.data.name} ===`);
    console.log('ID:', response.data.id);
    console.log('Name:', response.data.name);
    console.log('Parents:', response.data.parents);
    console.log('App Properties:', JSON.stringify(response.data.appProperties, null, 2));
    
    return response.data;
  } catch (error) {
    console.error(`Error inspecting folder ${folderId}:`, error.message);
  }
}

async function listSubfolders(folderId) {
  console.log(`\n=== Subfolders of ${folderId} ===`);
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,appProperties)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  
  if (response.data.files && response.data.files.length > 0) {
    for (const file of response.data.files) {
      console.log(`\n  - ${file.name}`);
      console.log(`    ID: ${file.id}`);
      console.log(`    App Properties: ${JSON.stringify(file.appProperties)}`);
    }
  } else {
    console.log('  No subfolders found');
  }
}

async function searchPluginFolders() {
  console.log('\n=== Searching for folders with pluginId app property ===');
  
  // Search with the OLD plugin ID
  const response1 = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='pluginId' and value='io.github.albertbaubledeem.joplin.google-docs' } and trashed=false`,
    fields: 'files(id,name,parents,appProperties)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 50,
  });
  
  console.log(`\nOld plugin ID (io.github.albertbaubledeem.joplin.google-docs): ${response1.data.files?.length || 0} folders`);
  
  if (response1.data.files && response1.data.files.length > 0) {
    for (const file of response1.data.files) {
      console.log(`\n  - ${file.name}`);
      console.log(`    ID: ${file.id}`);
      console.log(`    Parents: ${file.parents}`);
      console.log(`    App Properties: ${JSON.stringify(file.appProperties)}`);
    }
  }
  
  // Search with the NEW plugin ID
  const response2 = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='pluginId' and value='io.github.albertbaubledeem.joplin.google-docs' } and trashed=false`,
    fields: 'files(id,name,parents,appProperties)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 50,
  });
  
  console.log(`\nNew plugin ID (io.github.albertbaubledeem.joplin.google-docs): ${response2.data.files?.length || 0} folders`);
  
  if (response2.data.files && response2.data.files.length > 0) {
    for (const file of response2.data.files) {
      console.log(`\n  - ${file.name}`);
      console.log(`    ID: ${file.id}`);
      console.log(`    Parents: ${file.parents}`);
      console.log(`    App Properties: ${JSON.stringify(file.appProperties)}`);
    }
  }
}

async function main() {
  // Inspect both folders
  await inspectFolder(PARENT_FOLDER_ID, 'Expected Parent Folder');
  await inspectFolder(WRONG_FOLDER_ID, 'Currently Set (Wrong) Folder');
  
  // List subfolders of parent
  await listSubfolders(PARENT_FOLDER_ID);
  
  // Search for all folders with our plugin marker
  await searchPluginFolders();
}

main().catch(console.error);
