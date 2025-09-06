import fs from 'fs';
import path from 'path';

const DEFAULT_PATH = path.resolve(process.cwd(), 'mapping.json');

export function loadMapping(filePath = DEFAULT_PATH) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

export function saveMapping(data, filePath = DEFAULT_PATH) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function bindNote(noteId, binding, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	map[noteId] = { ...map[noteId], ...binding };
	saveMapping(map, filePath);
	return map[noteId];
}

export function getBinding(noteId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	return map[noteId] || null;
}

export function updateSyncCheckpoint(noteId, checkpoint, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	if (!map[noteId]) return null;
	map[noteId] = { ...map[noteId], ...checkpoint };
	saveMapping(map, filePath);
	return map[noteId];
}

export function markAccessLost(noteId, filePath = DEFAULT_PATH) {
	const map = loadMapping(filePath);
	if (!map[noteId]) return null;
	map[noteId].accessLost = true;
	saveMapping(map, filePath);
	return map[noteId];
}


