/**
 * List all Google Docs that were synced from Joplin notes.
 * 
 * Usage: node scripts/listSyncedDocs.js [--delete] [--dry-run]
 * 
 * Options:
 *   --delete   Delete all found docs (use with caution!)
 *   --dry-run  Show what would be deleted without actually deleting
 * 
 * This script finds all files with the 'joplinNoteId' app property,
 * which indicates they were created/synced by the Joplin plugin.
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const shouldDelete = process.argv.includes('--delete');
const isDryRun = process.argv.includes('--dry-run');

// Load OAuth tokens
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
if (!fs.existsSync(tokensPath)) {
  console.error(`Token file not found: ${tokensPath}`);
  console.error('Run the authorization flow first.');
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const drive = google.drive({ version: 'v3', auth });

async function findSyncedDocs(folderIds) {
  console.log('\nSearching for docs in sync folders...\n');
  
  const allFiles = [];
  
  for (const folderId of folderIds) {
    let pageToken = undefined;
    
    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, appProperties, webViewLink)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 100,
        pageToken,
      });
      
      if (response.data.files) {
        // Only include files that have joplinNoteId property
        const syncedFiles = response.data.files.filter(f => f.appProperties?.joplinNoteId);
        allFiles.push(...syncedFiles);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
  }
  
  return allFiles;
}

async function findSyncFolders() {
  console.log('Searching for sync folders with pluginId app property...\n');
  
  const folders = [];
  let pageToken = undefined;
  
  // Search for both old and new plugin IDs
  const pluginIds = [
    'io.github.albertbaubledeem.joplin.google-docs',
  ];
  
  for (const pluginId of pluginIds) {
    do {
      const response = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='pluginId' and value='${pluginId}' } and trashed=false`,
        fields: 'nextPageToken, files(id, name, createdTime, appProperties, webViewLink)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 100,
        pageToken,
      });
      
      if (response.data.files) {
        folders.push(...response.data.files);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
  }
  
  return folders;
}

async function deleteFile(file) {
  if (isDryRun) {
    console.log(`  [DRY RUN] Would delete: ${file.name} (${file.id})`);
    return true;
  }
  
  try {
    await drive.files.delete({
      fileId: file.id,
      supportsAllDrives: true,
    });
    console.log(`  ✓ Deleted: ${file.name} (${file.id})`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to delete ${file.name}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('Joplin Google Docs Sync - Find Synced Documents');
  console.log('='.repeat(70));
  
  if (shouldDelete) {
    console.log('\n⚠️  DELETE MODE ENABLED ⚠️');
    if (isDryRun) {
      console.log('   (Dry run - no actual deletions will occur)');
    } else {
      console.log('   WARNING: This will permanently delete files!');
    }
  }
  
  // Find sync folders
  const folders = await findSyncFolders();
  
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`SYNC FOLDERS (${folders.length} found)`);
  console.log('─'.repeat(70));
  
  for (const folder of folders) {
    console.log(`\n📁 ${folder.name}`);
    console.log(`   ID: ${folder.id}`);
    console.log(`   Created: ${folder.createdTime}`);
    console.log(`   Link: ${folder.webViewLink}`);
    console.log(`   App Properties: ${JSON.stringify(folder.appProperties)}`);
  }
  
  // Find synced docs (search within discovered folders)
  const folderIds = folders.map(f => f.id);
  const docs = await findSyncedDocs(folderIds);
  
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`SYNCED DOCUMENTS (${docs.length} found)`);
  console.log('─'.repeat(70));
  
  // Group by type
  const googleDocs = docs.filter(d => d.mimeType === 'application/vnd.google-apps.document');
  const otherFiles = docs.filter(d => d.mimeType !== 'application/vnd.google-apps.document');
  
  console.log(`\n  Google Docs: ${googleDocs.length}`);
  console.log(`  Other files: ${otherFiles.length}`);
  
  for (const doc of docs) {
    const props = doc.appProperties || {};
    console.log(`\n📄 ${doc.name}`);
    console.log(`   ID: ${doc.id}`);
    console.log(`   Type: ${doc.mimeType}`);
    console.log(`   Created: ${doc.createdTime}`);
    console.log(`   Modified: ${doc.modifiedTime}`);
    console.log(`   Joplin Note ID: ${props.joplinNoteId || 'N/A'}`);
    console.log(`   Link: ${doc.webViewLink}`);
    if (Object.keys(props).length > 1) {
      console.log(`   All Properties: ${JSON.stringify(props)}`);
    }
  }
  
  // Delete if requested
  if (shouldDelete && docs.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('DELETING DOCUMENTS...');
    console.log('─'.repeat(70));
    
    let successCount = 0;
    let failCount = 0;
    
    for (const doc of docs) {
      const success = await deleteFile(doc);
      if (success) successCount++;
      else failCount++;
    }
    
    console.log(`\nDeleted: ${successCount}, Failed: ${failCount}`);
    
    // Also offer to delete folders
    if (folders.length > 0) {
      console.log('\nNote: Sync folders were NOT deleted. Delete them manually if needed.');
      for (const folder of folders) {
        console.log(`  - ${folder.name}: ${folder.webViewLink}`);
      }
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Sync folders: ${folders.length}`);
  console.log(`  Synced documents: ${docs.length}`);
  
  if (!shouldDelete && docs.length > 0) {
    console.log('\nTo delete all synced documents, run:');
    console.log('  node scripts/listSyncedDocs.js --delete --dry-run  # Preview');
    console.log('  node scripts/listSyncedDocs.js --delete            # Actually delete');
  }
}

main().catch(console.error);

