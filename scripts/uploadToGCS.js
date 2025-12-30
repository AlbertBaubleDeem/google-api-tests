import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Upload Image to Google Cloud Storage
 * 
 * This script uploads an image to a GCS bucket using OAuth user credentials
 * (same as Drive/Docs - no service account needed).
 * 
 * The uploaded object is made temporarily public, returns the URL,
 * then revokes public access.
 * 
 * Usage: npm run uploadToGCS -- <imagePath>
 * 
 * Environment variables:
 * - GCS_BUCKET_NAME: Name of the GCS bucket
 */

const [imagePath] = process.argv.slice(2);

if (!imagePath) {
  console.error('Usage: npm run uploadToGCS -- <imagePath>');
  console.error('');
  console.error('Environment variables:');
  console.error('  GCS_BUCKET_NAME - Name of your GCS bucket');
  process.exit(1);
}

// Validate image file exists
if (!fs.existsSync(imagePath)) {
  console.error(`Error: Image file not found: ${imagePath}`);
  process.exit(1);
}

// Configuration
const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
  console.error('Error: GCS_BUCKET_NAME environment variable is required.');
  console.error('Add it to your .env file: GCS_BUCKET_NAME=your-bucket-name');
  process.exit(1);
}

// OAuth Setup
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
if (!fs.existsSync(tokensPath)) {
  console.error(`Error: OAuth tokens not found: ${tokensPath}`);
  console.error('Run: npm run auth');
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath));
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const storage = google.storage({ version: 'v1', auth });

// Generate unique filename to avoid collisions
function generateUniqueFilename(originalPath) {
  const ext = path.extname(originalPath);
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `img_${timestamp}_${randomBytes}${ext}`;
}

// Determine MIME type from extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function uploadAndGetPublicUrl(localPath) {
  const uniqueName = generateUniqueFilename(localPath);
  const mimeType = getMimeType(localPath);
  
  console.log('=== GCS Image Upload (OAuth) ===');
  console.log(`Local file: ${localPath}`);
  console.log(`Bucket: ${bucketName}`);
  console.log(`Destination: ${uniqueName}`);
  console.log(`MIME type: ${mimeType}`);
  console.log('');

  try {
    // Step 1: Upload file to GCS
    console.log('Step 1: Uploading to GCS...');
    await storage.objects.insert({
      bucket: bucketName,
      name: uniqueName,
      media: {
        mimeType: mimeType,
        body: fs.createReadStream(localPath),
      },
      requestBody: {
        name: uniqueName,
        contentType: mimeType,
      },
    });
    console.log('  Upload complete.');

    // Step 2: Make temporarily public
    console.log('Step 2: Making object public...');
    await storage.objectAccessControls.insert({
      bucket: bucketName,
      object: uniqueName,
      requestBody: {
        entity: 'allUsers',
        role: 'READER',
      },
    });
    console.log('  Public access granted.');

    // Build public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(uniqueName)}`;

    console.log('');
    console.log('=== SUCCESS ===');
    console.log('');
    console.log('Public URL:');
    console.log(publicUrl);
    console.log('');
    console.log('Use this URL with insertInlineImage:');
    console.log(`npm run insertImage -- <docId> "${publicUrl}"`);
    console.log('');
    console.log('Note: Run this to revoke access after use:');
    console.log(`gsutil acl ch -d allUsers gs://${bucketName}/${uniqueName}`);

    return {
      publicUrl,
      bucket: bucketName,
      objectName: uniqueName,
    };

  } catch (err) {
    console.error('');
    console.error('=== ERROR ===');
    const message = err?.response?.data?.error?.message || err?.message || err;
    console.error(message);
    
    if (err.code === 403 || String(message).includes('403')) {
      console.error('');
      console.error('Permission denied. Check that:');
      console.error('1. OAuth has devstorage.full_control scope');
      console.error('2. You have access to the bucket');
      console.error('3. Run: npm run auth (to refresh scopes)');
    }
    
    process.exit(2);
  }
}

// Export for use in other scripts
export { uploadAndGetPublicUrl };

// Run if called directly
uploadAndGetPublicUrl(imagePath);

