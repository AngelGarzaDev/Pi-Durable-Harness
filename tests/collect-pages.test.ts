import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPages } from "../src/chats.ts";

// 450 rows served 200 at a time, like scanConversations with limit 200.
const ROWS = Array.from({ length: 450 }, (_, i) => i);
function fakeScan(cursor: number | undefined) {
	const start = cursor ?? 0;
	const items = ROWS.slice(start, start + 200);
	const next = start + 200 < ROWS.length ? start + 200 : undefined;
	return Promise.resolve({ items, next });
}

test("collectPages follows every cursor, so more than one page of chats is listed", async () => {
	const all = await collectPages(fakeScan);
	assert.equal(all.length, 450);
	assert.deepEqual(all, ROWS);
});

test("collectPages returns an empty list for an empty store", async () => {
	assert.deepEqual(await collectPages(() => Promise.resolve({ items: [] as number[] })), []);
});
