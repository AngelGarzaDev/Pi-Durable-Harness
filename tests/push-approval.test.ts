// git_push end to end: the run parks on the approval card, Approve pushes, Reject pushes nothing. Uses a real git repo
// and bare origin on disk; the runner is a fetch stub that returns a real bundle; the model is the faux provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, Harness, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { GitPushService } from "../src/git-push.ts";
import { PUSH_TOOL, PushDecisionSignal, gitPushExtension, pendingPushes } from "../src/push-approval.ts";
import { pushDecisionMessage, pushSummaryLine } from "../public/push-view.js";

const ident = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main"];
const git = (cwd: string, args: string[]) => execFileSync("git", [...ident, ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
function commit(repo: string, file: string, text: string, message: string) {
	writeFileSync(join(repo, file), text);
	git(repo, ["add", file]);
	git(repo, ["commit", "-q", "-m", message]);
	return git(repo, ["rev-parse", "HEAD"]);
}

async function waitFor<T>(read: () => T | undefined, ms = 15000): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = read();
		if (v !== undefined) return v;
		if (Date.now() > end) throw new Error("timed out waiting");
		await new Promise((r) => setTimeout(r, 50));
	}
}

// Runs one git_push call with the given decision and returns what happened.
async function run(decision: "approve" | "reject") {
	const root = mkdtempSync(join(tmpdir(), "pdw-push-"));
	const origin = join(root, "origin.git");
	execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
	const work = join(root, "work");
	execFileSync("git", ["init", "-q", "-b", "main", work]);
	const tip = commit(work, "notes.md", "hello", "add notes");

	const fetchImpl = (async () => {
		const file = join(root, "served.bundle");
		git(work, ["bundle", "create", file, "refs/heads/main"]);
		return new Response(readFileSync(file), { status: 200 });
	}) as typeof fetch;
	const service = new GitPushService({ dataDir: join(root, "data"), runnerUrl: "http://runner.test", runnerToken: "r".repeat(32), remoteUrl: origin, getToken: () => "test-token", fetchImpl });

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(gitPushExtension(service));
	const storage = await openNodeSqliteStorage(join(root, "session.sqlite"));
	const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
	harness.resume();
	try {
		const model = faux.getModel();
		const chat = await harness.root(BACKGROUND_CONTEXT, { agent: { model: { provider: model.provider, modelId: model.id } } });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall(PUSH_TOOL, { reason: "Save my notes" }, { id: "p1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);
		const watch = await chat.watch(BACKGROUND_CONTEXT);
		watch.start(() => {});
		try {
			await chat.submit({ type: "input", content: "push my notes", whenBusy: "followUp" }, BACKGROUND_CONTEXT);
			const card = await waitFor(() => pendingPushes(watch.value.docs)[0]);
			const result = await harness.signal(card.taskId as unknown as TaskId, PushDecisionSignal, card.key, { approve: decision === "approve" }, BACKGROUND_CONTEXT);
			assert.equal(result, "delivered");
			await waitFor(() => (JSON.stringify(watch.value.entries).includes("Done.") ? true : undefined));
			return { card, entries: JSON.stringify(watch.value.entries), origin, tip, watch };
		} finally {
			await watch.stop();
		}
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

test("approval card shows the commits and files before anything is pushed", async () => {
	const r = await run("approve");
	assert.equal(r.card.tip, r.tip);
	assert.equal(r.card.reason, "Save my notes");
	assert.equal(r.card.commitCount, 1);
	assert.deepEqual(r.card.files, [{ status: "A", path: "notes.md" }]);
	assert.equal(r.card.branch, "main");
});

test("Approve pushes exactly the proposed commit to origin main", async () => {
	const r = await run("approve");
	assert.equal(git(r.origin, ["rev-parse", "main"]), r.tip);
	assert.match(r.entries, /Pushed 1 commit\(s\) to origin main/);
});

test("Reject pushes nothing: origin has no main, and the model is told", async () => {
	const r = await run("reject");
	assert.equal(git(r.origin, ["for-each-ref", "--format=%(refname)"]), "", "origin still empty");
	assert.match(r.entries, /The user rejected the push\. Nothing was pushed\./);
});

test("the card helpers build the decision message and the summary line", () => {
	const push = { taskId: 4, key: "k", commitCount: 2, filesTotal: 301, files: new Array(300).fill({ status: "M", path: "x" }) };
	assert.deepEqual(pushDecisionMessage(push, true), { type: "push-decide", taskId: 4, key: "k", approve: true });
	assert.deepEqual(pushDecisionMessage(push, false), { type: "push-decide", taskId: 4, key: "k", approve: false });
	assert.equal(pushDecisionMessage({ taskId: "x", key: "k" }, true), null);
	assert.equal(pushSummaryLine(push), "Push main to origin: 2 commits, 301 files (first 300 shown).");
	assert.equal(pushSummaryLine({ commitCount: 1, files: [{ status: "A", path: "a" }] }), "Push main to origin: 1 commit, 1 file.");
});
