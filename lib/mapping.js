import fs from 'fs';
import path from 'path';

const DEFAULT_PATH = path.resolve(process.cwd(), 'mapping.json');

export function loadMapping(filePath = DEFAULT_PATH) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		const data = JSON.parse(raw);
		// Back-compat: promote flat map to namespaced structure
		if (!data.notes && !data.notebooks) {
			return { notes: data, notebooks: {} };
		}
		if (!data.notes) data.notes = {};
		if (!data.notebooks) data.notebooks = {};
		return data;
	} catch {
		return { notes: {}, notebooks: {} };
	}
}

export function saveMapping(data, filePath = DEFAULT_PATH) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function bindNote(noteId, binding, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	map.notes[noteId] = { ...map.notes[noteId], ...binding };
	saveMapping(map, filePath);
	return map.notes[noteId];
}

export function getBinding(noteId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	return map.notes[noteId] || null;
}

export function updateSyncCheckpoint(noteId, checkpoint, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	if (!map.notes[noteId]) return null;
	map.notes[noteId] = { ...map.notes[noteId], ...checkpoint };
	saveMapping(map, filePath);
	return map.notes[noteId];
}

export function markAccessLost(noteId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	if (!map.notes[noteId]) return null;
	map.notes[noteId].accessLost = true;
	saveMapping(map, filePath);
	return map.notes[noteId];
}

// Notebook ↔ Doc binding (notebook → document)
export function bindNotebook(notebookId, binding, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	map.notebooks[notebookId] = { ...map.notebooks[notebookId], ...binding };
	saveMapping(map, filePath);
	return map.notebooks[notebookId];
}

export function getNotebookBinding(notebookId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	return map.notebooks[notebookId] || null;
}

// Reverse lookup: fileId -> noteId (first match)
export function findNoteIdByFileId(fileId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	for (const [noteId, binding] of Object.entries(map.notes)) {
		if (binding.fileId === fileId) return noteId;
	}
	return null;
}


