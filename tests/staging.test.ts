// Runner staging (runner/staging.ts) on a real temporary workspace: commit moves a folder, clashes get -2,
// discard is idempotent, and the sweep removes only old staging folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, utimesSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitStaged, discardStaged, sweepStaging } from "../runner/staging.ts";

const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);

function workspace(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), "pdw-stage-")));
}
function stage(root: string, folder: string, id: string, top: string, files: Record<string, string>): string {
	const top_ = join(root, folder, ".staging", id, top);
	for (const [rel, text] of Object.entries(files)) {
		const full = join(top_, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, text);
	}
	return top_;
}

test("commitStaged moves the staged folder into place and removes the id folder", () => {
	const root = workspace();
	const staged = stage(root, "proj", ID_A, "photos", { "a.txt": "one", "2026/b.txt": "two" });
	const r = commitStaged(root, staged, join(root, "proj"), "photos");
	assert.ok(r.ok);
	assert.equal(r.ok && r.name, "photos");
	assert.equal(readFileSync(join(root, "proj", "photos", "2026", "b.txt"), "utf8"), "two");
	assert.equal(existsSync(join(root, "proj", ".staging", ID_A)), false);
});

test("a taken folder name gets -2, then -3, and nothing is merged", () => {
	const root = workspace();
	mkdirSync(join(root, "proj", "photos"), { recursive: true });
	writeFileSync(join(root, "proj", "photos", "keep.txt"), "old");
	const staged = stage(root, "proj", ID_A, "photos", { "new.txt": "new" });
	const r = commitStaged(root, staged, join(root, "proj"), "photos");
	assert.ok(r.ok && r.name === "photos-2");
	assert.equal(readFileSync(join(root, "proj", "photos", "keep.txt"), "utf8"), "old");
	assert.equal(readFileSync(join(root, "proj", "photos-2", "new.txt"), "utf8"), "new");
});

test("commitStaged refuses paths that are not a staged folder", () => {
	const root = workspace();
	const staged = stage(root, "proj", ID_A, "photos", { "a.txt": "x" });
	assert.equal(commitStaged(root, staged, join(root, "proj"), "other").ok, false);
	assert.equal(commitStaged(root, join(root, "proj", "photos"), join(root, "proj"), "photos").ok, false);
	assert.equal(commitStaged(root, staged, join(root, "proj"), "..").ok, false);
	assert.equal(commitStaged(root, join(root, "proj", ".staging", "not-an-id", "photos"), join(root, "proj"), "photos").ok, false);
	assert.equal(existsSync(join(root, "proj", "photos")), false);
});

test("commitStaged refuses a destination outside the workspace or inside staging", () => {
	const root = workspace();
	const staged = stage(root, "proj", ID_A, "photos", { "a.txt": "x" });
	const outside = commitStaged(root, staged, join(root, "..", "elsewhere"), "photos");
	assert.equal(outside.ok, false);
	assert.equal(outside.ok === false && outside.status, 400);
	const inside = commitStaged(root, staged, join(root, "proj", ".staging", ID_B), "photos");
	assert.equal(inside.ok, false);
	assert.equal(existsSync(join(root, "elsewhere")), false);
});

test("commitStaged reports a missing staged folder as 404", () => {
	const root = workspace();
	const r = commitStaged(root, join(root, "proj", ".staging", ID_A, "gone"), join(root, "proj"), "gone");
	assert.equal(r.ok === false && r.status, 404);
});

test("discardStaged removes the whole id folder and is safe to repeat", () => {
	const root = workspace();
	stage(root, "proj", ID_A, "photos", { "a.txt": "x" });
	assert.ok(discardStaged(root, join(root, "proj", ".staging", ID_A)).ok);
	assert.equal(existsSync(join(root, "proj", ".staging", ID_A)), false);
	assert.ok(discardStaged(root, join(root, "proj", ".staging", ID_A)).ok);
	assert.equal(discardStaged(root, join(root, "proj")).ok, false);
	assert.equal(discardStaged(root, join(root, "proj", ".staging", "short")).ok, false);
});

test("sweepStaging removes only old staging folders", () => {
	const root = workspace();
	const oldDir = join(root, "proj", ".staging", ID_A);
	const freshDir = join(root, "proj", ".staging", ID_B);
	stage(root, "proj", ID_A, "old", { "a.txt": "x" });
	stage(root, "proj", ID_B, "new", { "b.txt": "y" });
	const now = Date.now();
	const old = new Date(now - 25 * 60 * 60 * 1000);
	utimesSync(oldDir, old, old);
	mkdirSync(join(root, "proj", ".staging", "not-an-id"));
	assert.equal(sweepStaging(root, now), 1);
	assert.deepEqual(readdirSync(join(root, "proj", ".staging")).sort(), [ID_B, "not-an-id"]);
	assert.equal(existsSync(freshDir), true);
	assert.equal(sweepStaging(join(root, "missing"), now), 0);
});
