import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthed, sessionValue, cookieValue, tokenMatches, SESSION_COOKIE } from "../src/auth.ts";

const token = "a".repeat(64);

test("a correct session cookie authenticates; a wrong or missing one does not", () => {
	const cookie = `${SESSION_COOKIE}=${sessionValue(token)}`;
	assert.equal(isAuthed(cookie, token), true);
	assert.equal(isAuthed(`${SESSION_COOKIE}=${sessionValue("b".repeat(64))}`, token), false);
	assert.equal(isAuthed(undefined, token), false);
	assert.equal(isAuthed(`other=1; ${SESSION_COOKIE}=nope`, token), false);
});

test("cookieValue finds the named cookie among several", () => {
	assert.equal(cookieValue("a=1; pdw_session=xyz; b=2", "pdw_session"), "xyz");
	assert.equal(cookieValue("a=1", "pdw_session"), undefined);
});

test("tokenMatches requires an exact match", () => {
	assert.equal(tokenMatches(token, token), true);
	assert.equal(tokenMatches(token.slice(1), token), false);
});
