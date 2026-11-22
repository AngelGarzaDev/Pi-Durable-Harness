import { test } from "node:test";
import assert from "node:assert/strict";
import { failureNotice } from "../src/notice.ts";

test("no notice when the newest run has no failure", () => {
	assert.equal(failureNotice(undefined), undefined);
	assert.equal(failureNotice({ "pi.live": {} }), undefined);
	assert.equal(failureNotice({ "pi.agent": { model: {} } }), undefined);
});

test("turn_limit notice names the tool rounds and points at the setting", () => {
	const text = failureNotice({ "pi.live": { runFailure: { reason: "turn_limit", detail: "3 turns" } } });
	assert.match(text!, /^Stopped after 3 turns\./);
	assert.match(text!, /Max tool rounds/);
});

test("other reasons get a readable notice", () => {
	assert.equal(failureNotice({ "pi.live": { runFailure: { reason: "aborted" } } }), "Stopped by you before an answer was finished.");
	assert.match(failureNotice({ "pi.live": { runFailure: { reason: "faulted", detail: "boom" } } })!, /faulted: boom/);
});
