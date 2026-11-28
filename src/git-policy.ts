// Policy for the approval-gated push (docs/DESIGN.md "Planned: approval-gated git push"). Pure functions, so the rules
// are tested without git or the network. The push service (src/git-push.ts) applies them to real bundles.
export const PUSH_BRANCH = "main";
export const PUSH_REF = `refs/heads/${PUSH_BRANCH}`;
// git's well-known empty tree: diffing against it lists every file of a first push.
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const MAX_LISTED_COMMITS = 200;

// Only main can be pushed. Anything else (another branch, a tag, a path) is refused before a bundle is made.
export function checkBranch(branch: unknown): { ok: true } | { ok: false; error: string } {
	if (branch !== PUSH_BRANCH) return { ok: false, error: `Only the ${PUSH_BRANCH} branch can be pushed.` };
	return { ok: true };
}

// `git bundle list-heads` prints "<sha> <ref>" lines. A bundle may carry only refs/heads/main: no tags, no other branches.
export function checkBundleHeads(listHeads: string): { ok: true; tip: string } | { ok: false; error: string } {
	const heads = listHeads
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "")
		.map((l) => {
			const [sha, ref] = l.split(" ");
			return { sha: sha ?? "", ref: ref ?? "" };
		})
		.filter((h) => !h.ref.startsWith("HEAD"));
	if (heads.length !== 1 || heads[0].ref !== PUSH_REF || !/^[0-9a-f]{40,64}$/.test(heads[0].sha)) {
		return { ok: false, error: `The bundle must contain only ${PUSH_REF}; it contains: ${heads.map((h) => h.ref).join(", ") || "nothing"}.` };
	}
	return { ok: true, tip: heads[0].sha };
}

// A push is allowed only when origin/main is an ancestor of the new tip (no force, no rewritten history).
export function checkFastForward(remoteTip: string | undefined, tip: string, isAncestor: boolean): { ok: true } | { ok: false; error: string } {
	if (remoteTip === undefined) return { ok: true }; // first push of main
	if (!isAncestor) {
		return { ok: false, error: "Not a fast-forward: origin/main has commits this bundle does not contain. Pull them first; force-push is not allowed." };
	}
	return { ok: true };
}

export type NameStatus = { status: string; path: string };

// Parses `git diff --name-status -z`: "M\0path\0", and for renames or copies "R100\0old\0new\0".
export function parseNameStatus(text: string): NameStatus[] {
	const parts = text.split("\0");
	const out: NameStatus[] = [];
	for (let i = 0; i + 1 < parts.length; ) {
		const status = parts[i];
		if (status === "") {
			i++;
			continue;
		}
		if (/^[RC]/.test(status)) {
			out.push({ status, path: `${parts[i + 1]} -> ${parts[i + 2] ?? ""}` });
			i += 3;
		} else {
			out.push({ status, path: parts[i + 1] });
			i += 2;
		}
	}
	return out;
}

export type CommitLine = { sha: string; author: string; subject: string };
// Parses `git log --format=%H%x1f%an%x1f%s%x1e`. Records end with \x1e, fields are separated by \x1f.
export function parseLog(text: string): CommitLine[] {
	return text
		.split("\x1e")
		.map((r) => r.replace(/^\n+/, "").trim())
		.filter((r) => r !== "")
		.map((r) => {
			const [sha, author, ...rest] = r.split("\x1f");
			return { sha, author, subject: rest.join("\x1f") };
		});
}

// Human summary of what a push would send, for the approval card.
export type PushSummary = { branch: string; tip: string; remoteTip: string | undefined; commits: CommitLine[]; commitCount: number; files: NameStatus[] };
