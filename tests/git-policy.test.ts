// The git push rules (src/git-policy.ts): branch, bundle heads, fast-forward, and parsing of git's output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBranch, checkBundleHeads, checkFastForward, parseLog, parseNameStatus } from "../src/git-policy.ts";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

test("only main can be pushed", () => {
	assert.equal(checkBranch("main").ok, true);
	for (const b of ["dev", "refs/heads/main", "main ", "", undefined, 3]) assert.equal(checkBranch(b).ok, false, String(b));
});

test("a bundle may carry only refs/heads/main", () => {
	assert.deepEqual(checkBundleHeads(`${SHA} refs/heads/main\n`), { ok: true, tip: SHA });
	assert.deepEqual(checkBundleHeads(`${SHA} refs/heads/main\n${OTHER} HEAD\n`), { ok: true, tip: SHA });
	assert.equal(checkBundleHeads(`${SHA} refs/heads/main\n${OTHER} refs/tags/v1\n`).ok, false, "tag refused");
	assert.equal(checkBundleHeads(`${SHA} refs/heads/dev\n`).ok, false, "other branch refused");
	assert.equal(checkBundleHeads("").ok, false, "empty refused");
	assert.equal(checkBundleHeads(`zz refs/heads/main\n`).ok, false, "bad sha refused");
});

test("no force: a push must fast-forward origin main", () => {
	assert.equal(checkFastForward(undefined, SHA, true).ok, true, "first push");
	assert.equal(checkFastForward(OTHER, SHA, true).ok, true, "fast-forward");
	const refused = checkFastForward(OTHER, SHA, false);
	assert.equal(refused.ok, false);
	assert.match(refused.ok ? "" : refused.error, /Not a fast-forward/);
});

test("parseNameStatus reads plain and renamed entries", () => {
	const text = "M\0src/a.ts\0A\0new.txt\0R100\0old.md\0new.md\0D\0gone.txt\0";
	assert.deepEqual(parseNameStatus(text), [
		{ status: "M", path: "src/a.ts" },
		{ status: "A", path: "new.txt" },
		{ status: "R100", path: "old.md -> new.md" },
		{ status: "D", path: "gone.txt" },
	]);
	assert.deepEqual(parseNameStatus(""), []);
});

test("parseLog splits records and fields, keeping a subject with a separator", () => {
	const text = `${SHA}\x1fAda\x1fFix: a\x1fb\x1e\n${OTHER}\x1fBo\x1fPlain\x1e`;
	assert.deepEqual(parseLog(text), [
		{ sha: SHA, author: "Ada", subject: "Fix: a\x1fb" },
		{ sha: OTHER, author: "Bo", subject: "Plain" },
	]);
});
