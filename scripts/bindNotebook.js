// Usage: npm run bindNotebook -- <notebookId> <fileId>
import { bindNotebook, getNotebookBinding } from '../lib/mapping.js';

const [notebookId, fileId] = process.argv.slice(2);
if (!notebookId || !fileId) {
	console.error('Usage: npm run bindNotebook -- <notebookId> <fileId>');
	process.exit(1);
}

bindNotebook(notebookId, { fileId, lastSyncTs: new Date().toISOString() });
console.log('notebook binding:', getNotebookBinding(notebookId));


