import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

/**
 * Image Insert POC
 * 
 * Workflow:
 * 1. Upload local image to Google Drive
 * 2. Create "anyone can view" permission (temporarily public)
 * 3. Build public URL
 * 4. Insert image into Google Doc using insertInlineImage
 * 5. Revoke public permission
 * 
 * Usage: npm run insertImage -- <docId> <imagePath> [index]
 */

const [docId, imagePath, indexArg] = process.argv.slice(2);
if (!docId || !imagePath) {
	console.error('Usage: npm run insertImage -- <docId> <imagePath> [index]');
	console.error('  docId     - Google Doc ID to insert image into');
	console.error('  imagePath - Path to local image file OR public URL (starting with http)');
	console.error('  index     - Optional insertion index (default: 1, start of doc)');
	process.exit(1);
}

// Check if imagePath is a URL (for testing with public images)
const isUrl = imagePath.startsWith('http://') || imagePath.startsWith('https://');
if (isUrl) {
	// Direct URL mode - skip upload, just insert
	console.log('=== Image Insert POC (Direct URL Mode) ===');
	console.log(`Doc ID: ${docId}`);
	console.log(`Image URL: ${imagePath}`);
	console.log(`Insert index: ${indexArg ? parseInt(indexArg, 10) : 1}`);
	console.log('');

	const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
	const tokens = JSON.parse(fs.readFileSync(tokensPath));
	const auth = new google.auth.OAuth2(
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET,
		process.env.GOOGLE_REDIRECT_URI,
	);
	auth.setCredentials(tokens);
	const docs = google.docs({ version: 'v1', auth });

	try {
		console.log('Inserting image from URL...');
		await docs.documents.batchUpdate({
			documentId: docId,
			requestBody: {
				requests: [{
					insertInlineImage: {
						location: { index: indexArg ? parseInt(indexArg, 10) : 1 },
						uri: imagePath,
					},
				}],
			},
		});
		console.log('=== SUCCESS ===');
		console.log('Image inserted from public URL!');
	} catch (err) {
		console.error('=== ERROR ===');
		console.error(err?.response?.data?.error?.message || err?.message || err);
	}
	process.exit(0);
}

const insertIndex = indexArg ? parseInt(indexArg, 10) : 1;

// Validate image file exists
if (!fs.existsSync(imagePath)) {
	console.error(`Error: Image file not found: ${imagePath}`);
	process.exit(1);
}

// Determine MIME type from extension
const ext = path.extname(imagePath).toLowerCase();
const mimeTypes = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
};
const mimeType = mimeTypes[ext];
if (!mimeType) {
	console.error(`Error: Unsupported image format: ${ext}`);
	console.error('Supported formats: PNG, JPG, JPEG, GIF, WEBP, BMP');
	process.exit(1);
}

// Setup auth
const tokensPath = process.env.GOOGLE_TOKENS_PATH || '.token.json';
const tokens = JSON.parse(fs.readFileSync(tokensPath));

const auth = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });

console.log('=== Image Insert POC ===');
console.log(`Doc ID: ${docId}`);
console.log(`Image: ${imagePath}`);
console.log(`Insert index: ${insertIndex}`);
console.log('');

let uploadedFileId = null;
let permissionId = null;

try {
	// Step 1: Upload image to Google Drive
	console.log('Step 1: Uploading image to Google Drive...');
	const fileName = path.basename(imagePath);
	const uploadRes = await drive.files.create({
		requestBody: {
			name: `temp_${Date.now()}_${fileName}`,
			// Don't set parents - goes to root/My Drive
		},
		media: {
			mimeType,
			body: fs.createReadStream(imagePath),
		},
		fields: 'id,name,webContentLink',
	});
	uploadedFileId = uploadRes.data.id;
	console.log(`  Uploaded: ${uploadRes.data.name} (ID: ${uploadedFileId})`);

	// Step 2: Create link-sharing permission
	console.log('Step 2: Creating link-sharing permission...');
	try {
		// First try "anyone" (truly public)
		const permRes = await drive.permissions.create({
			fileId: uploadedFileId,
			requestBody: {
				role: 'reader',
				type: 'anyone',
			},
			fields: 'id',
			supportsAllDrives: true,
		});
		permissionId = permRes.data.id;
		console.log(`  Public permission created (ID: ${permissionId})`);
	} catch (permErr) {
		console.log(`  Warning: "anyone" permission failed: ${permErr?.response?.data?.error?.message || permErr?.message}`);
		
		// Try domain-wide sharing if on Workspace
		try {
			console.log('  Trying domain-wide sharing...');
			// Get user's domain from their email
			const aboutRes = await drive.about.get({ fields: 'user' });
			const email = aboutRes.data.user?.emailAddress || '';
			const domain = email.split('@')[1];
			
			if (domain && !domain.includes('gmail.com')) {
				const domainPermRes = await drive.permissions.create({
					fileId: uploadedFileId,
					requestBody: {
						role: 'reader',
						type: 'domain',
						domain: domain,
					},
					fields: 'id',
				});
				permissionId = domainPermRes.data.id;
				console.log(`  Domain permission created for ${domain} (ID: ${permissionId})`);
			} else {
				console.log('  Not on a Workspace domain, cannot use domain sharing');
			}
		} catch (domainErr) {
			console.log(`  Domain sharing also failed: ${domainErr?.message}`);
		}
	}

	// Step 3: Build URL
	// Get all available URLs and try different formats
	const fileRes = await drive.files.get({
		fileId: uploadedFileId,
		fields: 'webContentLink,webViewLink,thumbnailLink',
	});
	
	// Try different URL formats - lh3.googleusercontent URLs work best for Docs API
	const possibleUrls = [
		`https://lh3.googleusercontent.com/d/${uploadedFileId}`,
		`https://drive.google.com/uc?export=view&id=${uploadedFileId}`,
		`https://drive.google.com/uc?id=${uploadedFileId}`,
		fileRes.data.webContentLink,
	].filter(Boolean);
	
	console.log('  Available URLs:');
	possibleUrls.forEach((url, i) => console.log(`    ${i + 1}. ${url}`));
	
	// Use the lh3 format which typically works best
	const imageUrl = possibleUrls[0];
	console.log(`  Using: ${imageUrl}`);

	// Step 4: Insert image into Google Doc
	console.log('Step 3: Inserting image into Google Doc...');
	const insertRes = await docs.documents.batchUpdate({
		documentId: docId,
		requestBody: {
			requests: [
				{
					insertInlineImage: {
						location: { index: insertIndex },
						uri: imageUrl,
						// Optional: set size (uncomment to use)
						// objectSize: {
						// 	height: { magnitude: 200, unit: 'PT' },
						// 	width: { magnitude: 200, unit: 'PT' },
						// },
					},
				},
			],
		},
	});
	console.log('  Image inserted successfully!');

	// Step 5: Revoke public permission
	console.log('Step 4: Revoking public permission...');
	await drive.permissions.delete({
		fileId: uploadedFileId,
		permissionId: permissionId,
	});
	console.log('  Public permission revoked');

	console.log('');
	console.log('=== SUCCESS ===');
	console.log(`Image inserted at index ${insertIndex}`);
	console.log(`Drive file ID: ${uploadedFileId} (permission revoked, file still exists)`);
	console.log('');
	console.log('Note: The uploaded image file remains in your Drive (private).');
	console.log('You may want to delete it manually or organize into a folder.');

} catch (err) {
	console.error('');
	console.error('=== ERROR ===');
	console.error(err?.response?.data?.error?.message || err?.message || err);
	
	// Attempt cleanup on error
	if (permissionId && uploadedFileId) {
		console.log('Attempting to revoke permission...');
		try {
			await drive.permissions.delete({
				fileId: uploadedFileId,
				permissionId: permissionId,
			});
			console.log('Permission revoked during cleanup.');
		} catch (cleanupErr) {
			console.error('Failed to revoke permission:', cleanupErr?.message);
		}
	}
	
	process.exit(2);
}

