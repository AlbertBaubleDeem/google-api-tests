// Usage: npm run bindNote -- <noteId> <fileId> <tabId>
import { bindNote, getBinding } from '../lib/mapping.js';

const [noteId, fileId, tabId] = process.argv.slice(2);
if (!noteId || !fileId || !tabId) {
	console.error('Usage: npm run bindNote -- <noteId> <fileId> <tabId>');
	process.exit(1);
}

bindNote(noteId, { fileId, tabId, lastSyncTs: new Date().toISOString() });
console.log('binding:', getBinding(noteId));


