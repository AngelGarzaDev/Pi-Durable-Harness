// Order of the chat list: oldest first. Chat ids come from storage in creation order, so sorting by id is chronological.
// A fork (child chat) is listed right under the chat it was branched from, also oldest first.
export function orderChats(chats) {
	const byId = new Map(chats.map((c) => [c.id, c]));
	const byOldest = (a, b) => a.id - b.id;
	const kids = new Map();
	const roots = [];
	for (const c of [...chats].sort(byOldest)) {
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
