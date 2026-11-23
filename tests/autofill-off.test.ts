// The chat box and the instructions box must not save typed text for browser autofill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");

function tagOf(id: string): string {
	const m = html.match(new RegExp(`<(input|textarea|form)[^>]*id="${id}"[^>]*>`));
	assert.ok(m, `no element #${id}`);
	return m[0];
}

test("chat box #msg has autocomplete off and no name, so no autofill history", () => {
	const tag = tagOf("msg");
	assert.match(tag, /autocomplete="off"/);
	assert.doesNotMatch(tag, /\sname=/);
});

test("chat form #f is autocomplete off", () => {
	assert.match(tagOf("f"), /autocomplete="off"/);
});

test("instructions box #instrtext has autocomplete off", () => {
	assert.match(tagOf("instrtext"), /autocomplete="off"/);
});
