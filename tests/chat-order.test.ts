import { test } from "node:test";
import assert from "node:assert/strict";
import { orderChats } from "../public/chat-order.js";

test("root chats are oldest first, by id", () => {
	const out = orderChats([{ id: 3, title: "c" }, { id: 1, title: "a" }, { id: 2, title: "b" }]);
	assert.deepEqual(out.map(([c]) => c.id), [1, 2, 3]);
	assert.ok(out.every(([, child]) => !child));
});

test("a fork sits right under its parent, oldest first", () => {
	const out = orderChats([
		{ id: 1, title: "root" },
		{ id: 4, title: "fork of 2", parentId: 2 },
		{ id: 2, title: "second" },
		{ id: 3, title: "fork of 1", parentId: 1 },
		{ id: 5, title: "later" },
	]);
	assert.deepEqual(out.map(([c, child]) => [c.id, child]), [[1, false], [3, true], [2, false], [4, true], [5, false]]);
});

test("a fork whose parent is missing is listed as a root", () => {
	const out = orderChats([{ id: 7, title: "orphan", parentId: 99 }]);
	assert.deepEqual(out.map(([c, child]) => [c.id, child]), [[7, false]]);
});
