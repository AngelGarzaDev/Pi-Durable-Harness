// Question cards for ask_user. Pure functions, so tests can load this file without a browser.

// The WebSocket message that answers a question. Returns null when there is nothing to send.
export function answerMessage(question, text) {
	const clean = typeof text === "string" ? text.trim() : "";
	if (!question || !clean) return null;
	return { type: "answer", taskId: question.taskId, key: question.key, text: clean };
}

// Text of the card header: the question itself, a short label for the buttons, and a hint.
export function questionHint(question) {
	return question.options && question.options.length
		? "Pick an option or type your own answer."
		: "Type your answer.";
}
