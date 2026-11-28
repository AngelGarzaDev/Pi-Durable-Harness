// The push service (src/git-push.ts) against a real git repo on disk. The runner is replaced by a fetch stub that
// returns a real `git bundle` of a local repo, so the bundle checks, the fast-forward check and the push are real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitPushService, NO_TOKEN } from "../src/git-push.ts";

const ident = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main"];
function git(cwd: string, args: string[]): string {
	return execFileSync("git", [...ident, ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
}
function commit(repo: string, file: string, text: string, message: string): string {
	writeFileSync(join(repo, file), text);
	git(repo, ["add", file]);
	git(repo, ["commit", "-q", "-m", message]);
	return git(repo, ["rev-parse", "HEAD"]);
}
// The runner's answer: a real bundle of refs/heads/main (plus any extra refs, for the refusal test).
function bundleFetch(repo: string, extraRefs: string[] = []): typeof fetch {
	return async () => {
		const file = join(mkdtempSync(join(tmpdir(), "pdw-test-bundle-")), "b.bundle");
		git(repo, ["bundle", "create", file, "refs/heads/main", ...extraRefs]);
		const { readFileSync } = await import("node:fs");
		return new Response(readFileSync(file), { status: 200 });
	};
}

function setup() {
	const root = mkdtempSync(join(tmpdir(), "pdw-git-"));
	const origin = join(root, "origin.git");
	execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
	const work = join(root, "work");
	execFileSync("git", ["init", "-q", "-b", "main", work]);
	const dataDir = join(root, "data");
	return { root, origin, work, dataDir };
}

function service(dataDir: string, origin: string, fetchImpl: typeof fetch, token: string | null = "test-token") {
	return new GitPushService({ dataDir, runnerUrl: "http://runner.test", runnerToken: "r".repeat(32), remoteUrl: origin, getToken: () => token ?? undefined, fetchImpl });
}

const ID = "11111111-2222-4333-8444-555555555555";

test("first push: origin is empty, the proposal lists every file, the push creates main", async () => {
	const s = setup();
	const tip = commit(s.work, "a.txt", "one", "first");
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work));
	const proposed = await svc.propose(ID, "main");
	assert.equal(proposed.ok, true);
	if (!proposed.ok) return;
	assert.equal(proposed.proposal.tip, tip);
	assert.equal(proposed.proposal.remoteTip, undefined);
	assert.equal(proposed.proposal.commitCount, 1);
	assert.deepEqual(proposed.proposal.files, [{ status: "A", path: "a.txt" }]);
	assert.equal(proposed.proposal.commits[0].subject, "first");
	const pushed = await svc.push(ID);
	assert.equal(pushed.ok, true);
	assert.equal(git(s.origin, ["rev-parse", "main"]), tip);
	// Nothing left in the push folder after a push.
	assert.deepEqual(readdirSync(join(s.dataDir, "pushes")), []);
});

test("second push: fast-forward moves origin main, and the list shows only the new commit", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work));
	await svc.propose(ID, "main").then((r) => r.ok && svc.push(ID));
	const tip2 = commit(s.work, "a.txt", "two", "second");
	const id2 = "22222222-2222-4333-8444-555555555555";
	const proposed = await svc.propose(id2, "main");
	assert.equal(proposed.ok, true);
	if (!proposed.ok) return;
	assert.equal(proposed.proposal.commitCount, 1);
	assert.deepEqual(proposed.proposal.files, [{ status: "M", path: "a.txt" }]);
	assert.equal((await svc.push(id2)).ok, true);
	assert.equal(git(s.origin, ["rev-parse", "main"]), tip2);
});

test("non-fast-forward: refused at proposal time, so no approval card is offered", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work));
	await svc.propose(ID, "main").then((r) => r.ok && svc.push(ID));
	// Someone else pushes to origin main from another clone; our local main diverges.
	const other = join(s.root, "other");
	execFileSync("git", ["clone", "-q", s.origin, other]);
	const theirs = commit(other, "b.txt", "theirs", "their change");
	git(other, ["push", "-q", "origin", "main"]);
	commit(s.work, "c.txt", "ours", "our change");
	const id2 = "33333333-2222-4333-8444-555555555555";
	const proposed = await svc.propose(id2, "main");
	assert.equal(proposed.ok, false);
	assert.match(proposed.ok ? "" : proposed.error, /Not a fast-forward/);
	assert.equal(git(s.origin, ["rev-parse", "main"]), theirs, "origin unchanged");
});

test("origin moves after the proposal: push re-checks, refuses, and origin is unchanged", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work));
	await svc.propose(ID, "main").then((r) => r.ok && svc.push(ID));
	commit(s.work, "a.txt", "two", "second");
	const id2 = "33333333-2222-4333-8444-555555555555";
	assert.equal((await svc.propose(id2, "main")).ok, true);
	const other = join(s.root, "other");
	execFileSync("git", ["clone", "-q", s.origin, other]);
	const theirs = commit(other, "b.txt", "theirs", "their change");
	git(other, ["push", "-q", "origin", "main"]);
	const pushed = await svc.push(id2);
	assert.equal(pushed.ok, false);
	assert.match(pushed.ok ? "" : pushed.error, /Not a fast-forward/);
	assert.equal(git(s.origin, ["rev-parse", "main"]), theirs, "origin unchanged");
	assert.deepEqual(readdirSync(join(s.dataDir, "pushes")), [], "pending files cleaned up");
});

test("a bundle that carries a tag is refused before anything is pushed", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	git(s.work, ["tag", "v1"]);
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work, ["refs/tags/v1"]));
	const proposed = await svc.propose(ID, "main");
	assert.equal(proposed.ok, false);
	assert.match(proposed.ok ? "" : proposed.error, /must contain only refs\/heads\/main/);
	assert.equal(existsSync(join(s.origin, "refs")), true);
	assert.equal(git(s.origin, ["for-each-ref", "--format=%(refname)"]), "", "origin has no refs");
});

test("no token: nothing is fetched from the runner and the error says where to add the token", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	let called = false;
	const svc = service(s.dataDir, s.origin, async () => ((called = true), new Response("")), null);
	const proposed = await svc.propose(ID, "main");
	assert.deepEqual(proposed, { ok: false, error: NO_TOKEN });
	assert.equal(called, false);
});

test("only main is accepted as a branch", async () => {
	const s = setup();
	commit(s.work, "a.txt", "one", "first");
	const svc = service(s.dataDir, s.origin, bundleFetch(s.work));
	assert.equal((await svc.propose(ID, "dev")).ok, false);
});
