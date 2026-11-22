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
