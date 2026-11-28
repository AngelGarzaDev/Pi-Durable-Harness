// Approval card for git_push. Pure functions, so tests can load this file without a browser.

// The WebSocket message that decides a push. Returns null when the push has no id to decide.
export function pushDecisionMessage(push, approve) {
	if (!push || typeof push.taskId !== "number" || typeof push.key !== "string") return null;
	return { type: "push-decide", taskId: push.taskId, key: push.key, approve: approve === true };
}

// Heading line: what is pushed, how many commits, and how many files, with the cut-off noted.
export function pushSummaryLine(push) {
	const commits = push.commitCount === 1 ? "1 commit" : `${push.commitCount} commits`;
	const total = push.filesTotal ?? (push.files ?? []).length;
	const files = total === 1 ? "1 file" : `${total} files`;
	const shown = (push.files ?? []).length;
	const cut = total > shown ? ` (first ${shown} shown)` : "";
	return `Push main to origin: ${commits}, ${files}${cut}.`;
}

// One line per commit: short sha, author, subject.
export function commitLine(commit) {
	return `${String(commit.sha ?? "").slice(0, 8)}  ${commit.author ?? ""}: ${commit.subject ?? ""}`;
}

// One line per file: git status letter and path.
export function fileLine(file) {
	return `${file.status}  ${file.path}`;
}
