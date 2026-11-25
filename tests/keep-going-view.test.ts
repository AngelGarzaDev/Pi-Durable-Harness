import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_GOING_STOP_KIND, isKeepGoingContinuation, keepGoingLine } from "../public/keep-going-view.js";
import { KEEP_GOING_TEXT } from "../src/keep-going.ts";

test("each stop reason has a transcript line", () => {
	assert.equal(keepGoingLine({ kind: KEEP_GOING_STOP_KIND, data: { reason: "done" } }), "Keep going stopped: the task is done.");
	assert.equal(keepGoingLine({ kind: KEEP_GOING_STOP_KIND, data: { reason: "cap" } }), "Keep going stopped: the limit was reached. Send a message to continue.");
	assert.equal(keepGoingLine({ kind: KEEP_GOING_STOP_KIND, data: { reason: "empty" } }), "Keep going stopped: the last answer was empty.");
	assert.equal(keepGoingLine({ kind: KEEP_GOING_STOP_KIND, data: {} }), "Keep going stopped.");
	assert.equal(keepGoingLine({ kind: "answer-review", data: {} }), null);
});

test("a continuation message is recognised so the transcript can hide it", () => {
	const cont = { kind: "pi.user", model: [{ role: "user", content: KEEP_GOING_TEXT }] };
	const user = { kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text: "write the report" }] }] };
	assert.equal(isKeepGoingContinuation(cont), true);
	assert.equal(isKeepGoingContinuation(user), false);
	assert.equal(isKeepGoingContinuation({ kind: "answer-review", model: [] }), false);
});
