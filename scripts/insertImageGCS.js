import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Insert Image into Google Docs via GCS Signed URL
 * 
 * Complete workflow:
 * 1. Upload local image to GCS bucket (using OAuth credentials)
 * 2. Make object publicly readable temporarily
 * 3. Insert image into Google Doc using Docs API
 * 4. Remove public access
 * 5. (Optional) Bucket lifecycle policy auto-deletes object later
 * 
 * This is the official Google-recommended workaround for the Drive image bug.
 * See: https://issuetracker.google.com/issues/150933939
 * 
 * Uses OAuth user credentials (same as Drive/Docs), no service account needed.
 * 
 * Usage: npm run insertImageGCS -- <docId> <imagePath> [index]
 * 
 * Environment variables:
 * - GCS_BUCKET_NAME: Name of the GCS bucket
 */

const [docId, imagePath, indexArg] = process.argv.slice(2);

if (!docId || !imagePath) {
  console.error('Usage: npm run insertImageGCS -- <docId> <imagePath> [index]');
  console.error('');
  console.error('Arguments:');
  console.error('  docId     - Google Doc ID to insert image into');
  console.error('  imagePath - Path to local image file');
  console.error('  index     - Optional insertion index (default: 1)');
  console.error('');
  console.error('Environment variables (in .env):');
  console.error('  GCS_BUCKET_NAME - Your GCS bucket name');
  process.exit(1);
}

const insertIndex = indexArg ? parseInt(indexArg, 10) : 1;

// Validate image file exists
if (!fs.existsSync(imagePath)) {
  console.error(`Error: Image file not found: ${imagePath}`);
  process.exit(1);
}

// GCS Configuration
const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
  console.error('Error: GCS_BUCKET_NAME environment variable is required.');
  console.error('Add to .env: GCS_BUCKET_NAME=your-bucket-name');
  process.exit(1);
}

// OAuth Setup (same as Drive/Docs)
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

// Initialize APIs
const storage = google.storage({ version: 'v1', auth });
const docs = google.docs({ version: 'v1', auth });

// Helper functions
function generateUniqueFilename(originalPath) {
  const ext = path.extname(originalPath);
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `img_${timestamp}_${randomBytes}${ext}`;
}

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

async function insertImageViaGCS() {
  const uniqueName = generateUniqueFilename(imagePath);
  const mimeType = getMimeType(imagePath);

  console.log('=== Insert Image via GCS (OAuth) ===');
  console.log(`Doc ID: ${docId}`);
  console.log(`Image: ${imagePath}`);
  console.log(`GCS Bucket: ${bucketName}`);
  console.log(`Insert index: ${insertIndex}`);
  console.log('');

  let objectName = uniqueName;

  try {
    // Step 1: Upload to GCS using googleapis
    console.log('Step 1: Uploading image to GCS...');
    
    const fileContent = fs.readFileSync(imagePath);
    
    await storage.objects.insert({
      bucket: bucketName,
      name: uniqueName,
      media: {
        mimeType: mimeType,
        body: fs.createReadStream(imagePath),
      },
      requestBody: {
        name: uniqueName,
        contentType: mimeType,
        metadata: {
          source: 'joplin-google-docs-plugin',
          docId: docId,
        },
      },
    });
    console.log(`  Uploaded: ${uniqueName}`);

    // Step 2: Make object publicly readable (temporarily)
    console.log('Step 2: Making object publicly accessible...');
    await storage.objectAccessControls.insert({
      bucket: bucketName,
      object: uniqueName,
      requestBody: {
        entity: 'allUsers',
        role: 'READER',
      },
    });
    console.log('  Public access granted.');

    // Step 3: Build public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(uniqueName)}`;
    console.log(`  Public URL: ${publicUrl}`);

    // Step 4: Insert into Google Doc
    console.log('Step 3: Inserting image into Google Doc...');
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{
          insertInlineImage: {
            location: { index: insertIndex },
            uri: publicUrl,
          },
        }],
      },
    });
    console.log('  Image inserted successfully!');

    // Step 5: Remove public access
    console.log('Step 4: Removing public access...');
    await storage.objectAccessControls.delete({
      bucket: bucketName,
      object: uniqueName,
      entity: 'allUsers',
    });
    console.log('  Public access revoked.');

    console.log('');
    console.log('=== SUCCESS ===');
    console.log(`Image inserted at index ${insertIndex}`);
    console.log(`GCS object: gs://${bucketName}/${uniqueName}`);
    console.log('');
    console.log('The object is now private again.');
    console.log('Bucket lifecycle policy will auto-delete it later.');

    return {
      success: true,
      docId,
      gcsObject: `gs://${bucketName}/${uniqueName}`,
    };

  } catch (err) {
    console.error('');
    console.error('=== ERROR ===');
    
    const message = err?.response?.data?.error?.message || err?.message || err;
    console.error(message);

    // Try to clean up public access on error
    try {
      await storage.objectAccessControls.delete({
        bucket: bucketName,
        object: objectName,
        entity: 'allUsers',
      });
      console.log('Cleaned up public access after error.');
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

    if (err.code === 403 || String(message).includes('permission') || String(message).includes('403')) {
      console.error('');
      console.error('Permission issue. Check:');
      console.error('1. OAuth has devstorage.full_control scope');
      console.error('2. You have access to the bucket');
      console.error('3. Run: npm run auth (to get new scopes)');
    }

    if (String(message).includes('retrieving the image')) {
      console.error('');
      console.error('Docs API could not fetch the image. The public access might not have propagated.');
    }

    process.exit(2);
  }
}

// Run
insertImageViaGCS();

