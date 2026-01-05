/**
 * Script to update Google Drive folder/file app properties from old plugin ID to new.
 * 
 * Usage: node scripts/updatePluginId.js <old-plugin-id> [--dry-run]
 * 
 * Example: node scripts/updatePluginId.js io.old.plugin.id --dry-run
 * 
 * This script:
 * 1. Searches for all files/folders with the old pluginId app property
 * 2. Updates them to use the new pluginId
 * 
 * Run with --dry-run first to see what would be changed.
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const NEW_PLUGIN_ID = 'io.github.albertbaubledeem.joplin.google-docs';

// Parse arguments
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const isDryRun = process.argv.includes('--dry-run');

if (args.length === 0) {
  console.error('Usage: node scripts/updatePluginId.js <old-plugin-id> [--dry-run]');
  console.error('Example: node scripts/updatePluginId.js io.old.plugin.id --dry-run');
  process.exit(1);
}

const OLD_PLUGIN_ID = args[0];

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

async function findFilesWithOldPluginId() {
  console.log(`\nSearching for files with pluginId='${OLD_PLUGIN_ID}'...`);
  
  const files = [];
  let pageToken = undefined;
  
  do {
    const response = await drive.files.list({
      q: `appProperties has { key='pluginId' and value='${OLD_PLUGIN_ID}' } and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, appProperties)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
      pageToken,
    });
    
    if (response.data.files) {
      files.push(...response.data.files);
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  
  return files;
}

async function updatePluginId(file) {
  const { id, name, mimeType, appProperties } = file;
  
  console.log(`\n  Updating: ${name}`);
  console.log(`    ID: ${id}`);
  console.log(`    Type: ${mimeType}`);
  console.log(`    Current appProperties: ${JSON.stringify(appProperties)}`);
  
  if (isDryRun) {
    console.log(`    [DRY RUN] Would update pluginId to: ${NEW_PLUGIN_ID}`);
    return true;
  }
  
  try {
    await drive.files.update({
      fileId: id,
      supportsAllDrives: true,
      requestBody: {
        appProperties: {
          ...appProperties,
          pluginId: NEW_PLUGIN_ID,
        },
      },
    });
    console.log(`    ✓ Updated pluginId to: ${NEW_PLUGIN_ID}`);
    return true;
  } catch (error) {
    console.error(`    ✗ Failed to update: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Google Drive Plugin ID Migration Script');
  console.log('='.repeat(60));
  console.log(`\nOld ID: ${OLD_PLUGIN_ID}`);
  console.log(`New ID: ${NEW_PLUGIN_ID}`);
  
  if (isDryRun) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***');
  }
  
  // Find all files with old plugin ID
  const files = await findFilesWithOldPluginId();
  
  if (files.length === 0) {
    console.log('\nNo files found with the old plugin ID.');
    console.log('Migration may have already been completed.');
    return;
  }
  
  console.log(`\nFound ${files.length} file(s) to update:`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const file of files) {
    const success = await updatePluginId(file);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Total files found: ${files.length}`);
  console.log(`  Successfully updated: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  
  if (isDryRun) {
    console.log('\n*** This was a dry run. Run without --dry-run to apply changes. ***');
  }
}

main().catch(console.error);
