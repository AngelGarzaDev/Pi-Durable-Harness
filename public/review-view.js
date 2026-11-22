// Transcript text for answer reviews. Pure functions, so tests can load this file without a browser.

export const ANSWER_REVIEW_KIND = "answer-review";
export const REVIEW_MARK = "[Review]";

// The entry a review writes: { verdict: "pass" | "fail" | "error", notes }. Returns the line to show, or null.
export function reviewLine(entry) {
	if (!entry || entry.kind !== ANSWER_REVIEW_KIND) return null;
	const data = entry.data ?? {};
	if (data.verdict === "pass") return "Review: PASS. The reviewer accepted the answer.";
	if (data.verdict === "fail") return `Review: FAIL. The answer was sent back once.\n${data.notes ?? ""}`.trimEnd();
	return `Review could not run, so the answer stands. ${data.notes ?? ""}`.trimEnd();
}

// The user message a failed review sends back to the agent. It is shown through the review line instead.
export function isReviewContinuation(entry) {
	const msg = Array.isArray(entry?.model) ? entry.model[0] : undefined;
	if (entry?.kind !== "pi.user" || msg?.role !== "user") return false;
	const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
	return text.startsWith(REVIEW_MARK);
}
