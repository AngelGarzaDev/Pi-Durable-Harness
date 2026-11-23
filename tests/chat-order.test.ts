import { test } from "node:test";
import assert from "node:assert/strict";
import { orderChats } from "../public/chat-order.js";

test("root chats are newest first, by id", () => {
	const out = orderChats([{ id: 3, title: "c" }, { id: 1, title: "a" }, { id: 2, title: "b" }]);
	assert.deepEqual(out.map(([c]) => c.id), [3, 2, 1]);
	assert.ok(out.every(([, child]) => !child));
});

test("a fork sits right under its parent, newest first", () => {
	const out = orderChats([
		{ id: 1, title: "root" },
		{ id: 4, title: "fork of 2", parentId: 2 },
		{ id: 2, title: "second" },
		{ id: 3, title: "fork of 1", parentId: 1 },
		{ id: 5, title: "later" },
	]);
	assert.deepEqual(out.map(([c, child]) => [c.id, child]), [[5, false], [2, false], [4, true], [1, false], [3, true]]);
});

test("a fork whose parent is missing is listed as a root", () => {
	const out = orderChats([{ id: 7, title: "orphan", parentId: 99 }]);
	assert.deepEqual(out.map(([c, child]) => [c.id, child]), [[7, false]]);
});

import { groupByFolder } from "../public/chat-order.js";

test("sidebar groups: one group per folder, newest folder first, no-folder chats last", () => {
	const groups = groupByFolder([
		{ id: 1, title: "a", folder: "" },
		{ id: 2, title: "b", folder: "notes" },
		{ id: 3, title: "c", folder: "" },
		{ id: 4, title: "d", folder: "work" },
		{ id: 5, title: "e", folder: "notes" },
	]);
	assert.deepEqual(groups.map((g) => g.folder), ["notes", "work", ""]); // notes holds chat 5, the newest
	assert.deepEqual(groups[0].chats.map(([c]) => c.id), [5, 2]);
	assert.deepEqual(groups[1].chats.map(([c]) => c.id), [4]);
	assert.deepEqual(groups[2].chats.map(([c]) => c.id), [3, 1]);
});

test("sidebar groups: a fork stays in its parent's folder, under the parent", () => {
	const groups = groupByFolder([
		{ id: 7, title: "root", folder: "notes" },
		{ id: 8, title: "fork", folder: "notes", parentId: 7 },
	]);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].chats.map(([c, child]) => [c.id, child]), [[7, false], [8, true]]);
});

test("sidebar groups: no chats gives no groups", () => {
	assert.deepEqual(groupByFolder([]), []);
});
