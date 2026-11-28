// The app's side of the approval-gated push. The app holds the GitHub token (from the secret store), the runner never
// sees it. Steps: ask the runner for a bundle of main, check it, list what it would send, and push only after approval.
// The token goes to git through GIT_CONFIG_* environment variables: never on the command line, in a file or in logs.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkBranch, checkBundleHeads, checkFastForward, EMPTY_TREE, MAX_LISTED_COMMITS, parseLog, parseNameStatus, PUSH_BRANCH, PUSH_REF, type CommitLine, type NameStatus } from "./git-policy.js";

export const GITHUB_TOKEN_SECRET = "github_repo_token";
export const NO_TOKEN = `No GitHub token is set. Add it in Secrets as ${GITHUB_TOKEN_SECRET}.`;

export type Proposal = { id: string; tip: string; remoteTip?: string; commitCount: number; commits: CommitLine[]; files: NameStatus[] };
export type PushOutcome = { ok: true; message: string } | { ok: false; error: string };

export type PushServiceOptions = {
	dataDir: string;
	runnerUrl: string;
	runnerToken: string;
	remoteUrl: string;
	// Returns the GitHub token from the secret store, or undefined when none is set.
	getToken: () => string | undefined;
	fetchImpl?: typeof fetch;
};

export class GitPushService {
	private readonly dir: string;
	private readonly mirror: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly opts: PushServiceOptions) {
		this.dir = join(opts.dataDir, "pushes");
		this.mirror = join(opts.dataDir, "git-mirror.git");
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}

	// Asks the runner for a bundle, checks it and lists what it would send. Nothing is pushed here. `id` is the
	// approval's id (memoized by the tool), so a rerun writes the same files.
	async propose(id: string, branch: unknown): Promise<{ ok: true; proposal: Proposal } | { ok: false; error: string }> {
		const policy = checkBranch(branch);
		if (!policy.ok) return policy;
		if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Bad push id." };
		if (!this.opts.remoteUrl) return { ok: false, error: "GIT_REMOTE_URL is not set, so there is no repository to push to." };
		if (!this.opts.getToken()) return { ok: false, error: NO_TOKEN };
		mkdirSync(this.dir, { recursive: true });
		const bundlePath = join(this.dir, `${id}.bundle`);
		let r: Response;
		try {
			r = await this.fetchImpl(`${this.opts.runnerUrl}/v1/git/bundle`, {
				method: "POST",
				headers: { authorization: `Bearer ${this.opts.runnerToken}`, "content-type": "application/json" },
				body: JSON.stringify({ branch: PUSH_BRANCH }),
			});
		} catch {
			return { ok: false, error: "Could not reach the runner." };
		}
		if (!r.ok) {
			const body = (await r.json().catch(() => ({}))) as { error?: string };
			return { ok: false, error: body.error ?? "The runner refused to make a bundle." };
		}
		writeFileSync(bundlePath, Buffer.from(await r.arrayBuffer()));
		try {
			const tip = await this.inspectBundle(bundlePath);
			if (typeof tip !== "string") return { ok: false, error: tip.error };
			await this.ensureMirror();
			await this.git(["fetch", "--quiet", bundlePath, `${PUSH_REF}:refs/bundles/${id}`]);
			const remoteTip = await this.fetchRemoteMain();
			const ancestor = remoteTip === undefined ? true : await this.isAncestor(remoteTip, tip);
			const ff = checkFastForward(remoteTip, tip, ancestor);
			if (!ff.ok) return ff;
			const range = remoteTip === undefined ? [tip] : [`${remoteTip}..${tip}`];
			const log = await this.git(["log", `--format=%H%x1f%an%x1f%s%x1e`, `-n`, String(MAX_LISTED_COMMITS), ...range]);
			const count = await this.git(["rev-list", "--count", ...range]);
			const files = await this.git(["diff", "--name-status", "-z", remoteTip ?? EMPTY_TREE, tip]);
			const proposal: Proposal = {
				id,
				tip,
				remoteTip,
				commitCount: Number(count.trim()),
				commits: parseLog(log),
				files: parseNameStatus(files),
			};
			writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(proposal));
			return { ok: true, proposal };
		} catch (error) {
			return { ok: false, error: this.clean(error instanceof Error ? error.message : String(error)) };
		} finally {
			rmSync(bundlePath, { force: true });
		}
	}

	// Pushes the proposal's tip to origin main. Re-checks the fast-forward rule against the current origin/main first.
	async push(id: string): Promise<PushOutcome> {
		const file = join(this.dir, `${id}.json`);
		if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(file)) return { ok: false, error: "This push is no longer pending." };
		const proposal = JSON.parse(readFileSync(file, "utf8")) as Proposal;
		try {
			const remoteTip = await this.fetchRemoteMain();
			const ancestor = remoteTip === undefined ? true : await this.isAncestor(remoteTip, proposal.tip);
			const ff = checkFastForward(remoteTip, proposal.tip, ancestor);
			if (!ff.ok) return ff;
			await this.git(["push", "--quiet", "origin", `${proposal.tip}:${PUSH_REF}`], true);
			return { ok: true, message: `Pushed ${proposal.commitCount} commit(s) to origin ${PUSH_BRANCH}.` };
		} catch (error) {
			return { ok: false, error: this.clean(error instanceof Error ? error.message : String(error)) };
		} finally {
			this.discard(id);
		}
	}

	discard(id: string): void {
		if (!/^[0-9a-f-]{36}$/.test(id)) return;
		rmSync(join(this.dir, `${id}.json`), { force: true });
		rmSync(join(this.dir, `${id}.bundle`), { force: true });
	}

	private async inspectBundle(path: string): Promise<string | { error: string }> {
		try {
			await this.ensureMirror();
			// bundle commands read the bundle header; verify also needs a repository, so both run in the mirror.
			const out = await this.git(["bundle", "list-heads", path]);
			const checked = checkBundleHeads(out);
			if (!checked.ok) return { error: checked.error };
			await this.git(["bundle", "verify", path]);
			return checked.tip;
		} catch (error) {
			return { error: this.clean(error instanceof Error ? error.message : String(error)) };
		}
	}

	private async ensureMirror(): Promise<void> {
		if (!existsSync(join(this.mirror, "HEAD"))) await this.gitRaw(["init", "--bare", "--quiet", this.mirror]);
		// Re-point origin on every call, so a changed GIT_REMOTE_URL takes effect without deleting the mirror.
		await this.git(["remote", "remove", "origin"]).catch(() => undefined);
		await this.git(["remote", "add", "origin", this.opts.remoteUrl]);
	}

	// Asks origin for its main. Errors (auth, network) propagate: a failed lookup must never look like "no main yet".
	// Returns undefined only when origin has no main; otherwise fetches that commit into the mirror.
	private async fetchRemoteMain(): Promise<string | undefined> {
		const listed = await this.git(["ls-remote", "origin", PUSH_REF], true);
		const sha = listed.split(/\s+/)[0] ?? "";
		if (!sha) return undefined;
		if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("origin returned an unexpected main reference.");
		await this.git(["fetch", "--quiet", "origin", `+${PUSH_REF}:refs/remotes/origin/${PUSH_BRANCH}`], true);
		return sha;
	}

	private async isAncestor(ancestor: string, tip: string): Promise<boolean> {
		try {
			await this.git(["merge-base", "--is-ancestor", ancestor, tip]);
			return true;
		} catch {
			return false;
		}
	}

	// Runs git inside the mirror. `withToken` adds the GitHub credential for origin only.
	private git(args: string[], withToken = false): Promise<string> {
		return this.gitRaw(["--git-dir", this.mirror, ...args], withToken);
	}

	private gitRaw(args: string[], withToken = false): Promise<string> {
		const token = withToken ? this.opts.getToken() : undefined;
		if (withToken && !token) return Promise.reject(new Error(NO_TOKEN));
		return new Promise((resolve, reject) => {
			execFile("git", args, { env: this.env(token), maxBuffer: 16 * 1024 * 1024, timeout: 300_000 }, (err, stdout, stderr) => {
				if (err) return reject(new Error(this.clean(String(stderr || err.message))));
				resolve(String(stdout));
			});
		});
	}

	// A small environment: no app secrets (the Anthropic key is in process.env), and no prompts or credential helpers.
	private env(token: string | undefined): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: this.dir,
			GIT_TERMINAL_PROMPT: "0",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
		};
		if (token && /^https?:\/\//.test(this.opts.remoteUrl)) {
			const origin = new URL(this.opts.remoteUrl).origin + "/";
			env.GIT_CONFIG_COUNT = "1";
			env.GIT_CONFIG_KEY_0 = `http.${origin}.extraheader`;
			env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
		}
		return env;
	}

	// Removes the token (and its base64 form) from any text that could reach a log or the browser.
	private clean(text: string): string {
		let out = text;
		const token = this.opts.getToken();
		if (token) out = out.split(token).join("[token]").split(Buffer.from(`x-access-token:${token}`).toString("base64")).join("[token]");
		return out.trim().slice(0, 500);
	}
}
