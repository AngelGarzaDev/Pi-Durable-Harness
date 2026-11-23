// Order of the chat list: newest first (reverse chronological). Chat ids come from storage in creation order, so sorting by id descending is newest-first.
// A fork (child chat) is listed right under the chat it was branched from, also newest first.
export function orderChats(chats) {
	const byId = new Map(chats.map((c) => [c.id, c]));
	const byNewest = (a, b) => b.id - a.id;
	const kids = new Map();
	const roots = [];
	for (const c of [...chats].sort(byNewest)) {
		if (c.parentId && byId.has(c.parentId)) {
			if (!kids.has(c.parentId)) kids.set(c.parentId, []);
			kids.get(c.parentId).push(c);
		} else roots.push(c);
	}
	const out = [];
	const walk = (c, child) => {
		out.push([c, child]);
		for (const k of kids.get(c.id) ?? []) walk(k, true);
	};
	for (const r of roots) walk(r, false);
	return out;
}

// Sidebar groups: one group per folder, then the chats with no folder. Folders are ordered by their newest chat
// (newest first); the no-folder group comes last. Within a group, orderChats applies (forks under their parent).
// A chat's folder is c.folder ("" or missing = no folder). Forks share their parent's folder, so they stay together.
export const NO_FOLDER = "";
export function groupByFolder(chats) {
	const groups = new Map();
	for (const c of chats) {
		const key = c.folder || NO_FOLDER;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(c);
	}
	const newest = (list) => Math.max(...list.map((c) => c.id));
	return [...groups.entries()]
		.sort(([ka, la], [kb, lb]) => (ka === NO_FOLDER) - (kb === NO_FOLDER) || newest(lb) - newest(la))
		.map(([folder, list]) => ({ folder, chats: orderChats(list) }));
}
