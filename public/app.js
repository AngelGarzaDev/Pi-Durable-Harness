// Browser client: chat list, transcript, settings, and chat actions (send, steer, fork, reset, compact).
import { reviewLine, isReviewContinuation } from "./review-view.js";
const ws = new WebSocket(`ws://${location.host}/ws`);
const out = document.getElementById("transcript");
const status = document.getElementById("status");
const titleEl = document.getElementById("title");
const chatList = document.getElementById("chatlist");
let openId = null;

function blockText(content) {
	if (typeof content === "string") return content;
	return (content ?? []).map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image]" : "")).join("");
}

// Each entry holds zero or more messages. One display item per message part.
function items(entry) {
	const review = reviewLine(entry);
	if (review) return [{ cls: "review", label: "", text: review }];
	if (isReviewContinuation(entry)) return [];
	const msgs = Array.isArray(entry.model) ? entry.model : [];
	if (msgs.length === 0) return [{ cls: "other", label: entry.kind, text: "" }];
	const result = [];
	for (const msg of msgs) {
		if (msg.role === "system") continue;
		if (msg.role === "user") {
			result.push({ cls: "user", label: "you", text: blockText(msg.content) });
		} else if (msg.role === "toolResult" || msg.role === "tool") {
			const err = msg.isError ? " (error)" : "";
			result.push({ cls: msg.isError ? "tool-error" : "tool-result", label: `result ${msg.toolName ?? ""}${err}`, text: blockText(msg.content) });
		} else {
			for (const b of Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content ?? "") }]) {
				if (b.type === "text" && b.text) result.push({ cls: "assistant", label: "claude", text: b.text });
				else if (b.type === "toolCall") result.push({ cls: "tool-call", label: `call ${b.name}`, text: JSON.stringify(b.arguments ?? {}) });
			}
		}
	}
	return result;
}

// Branch button on user and Claude messages: forks the chat up to and including that entry.
// Notice above the transcript when the newest run ended without an answer (for example the turn limit).
function showNotice(text) {
	const el = document.getElementById("notice");
	el.textContent = text ?? "";
	el.hidden = !text;
}

function render(entries) {
	out.textContent = "";
	for (const e of entries) {
		for (const it of items(e)) {
			const div = document.createElement("div");
			div.className = it.cls;
			div.textContent = it.cls === "review" ? it.text : it.text ? `${it.label}: ${it.text}` : it.label;
			out.appendChild(div);
		}
		if ((e.kind === "pi.user" || e.kind === "pi.assistant") && Array.isArray(e.model) && e.model.length) {
			const b = document.createElement("button");
			b.className = "branch";
			b.textContent = "branch from here";
			b.title = "Start a new chat with the history up to this message";
			b.onclick = () => {
				if (confirm("Start a new chat that copies the history up to this message?")) ws.send(JSON.stringify({ type: "fork", entryId: e.id }));
			};
			out.lastChild.appendChild(b);
		}
	}
	out.scrollTop = out.scrollHeight;
}

function renderChats(chats) {
	chatList.textContent = "";
	const byId = new Map(chats.map((c) => [c.id, c]));
	const ordered = [];
	for (const c of chats) if (!c.parentId || !byId.has(c.parentId)) ordered.push([c, false]);
	for (const c of chats) if (c.parentId && byId.has(c.parentId)) ordered.push([c, true]);
	for (const [c, child] of ordered) {
		const b = document.createElement("button");
		b.className = "chat" + (child ? " child" : "") + (c.id === openId ? " active" : "");
		b.textContent = (child ? "↳ " : "") + c.title;
		b.title = c.title;
		b.onclick = () => ws.send(JSON.stringify({ type: "open", conversationId: c.id }));
		chatList.appendChild(b);
	}
}

ws.onopen = () => (status.textContent = "connected");
ws.onclose = () => (status.textContent = "disconnected, reload to reconnect");
ws.onmessage = (e) => {
	const msg = JSON.parse(e.data);
	if (msg.type === "view") {
		render(msg.view.entries);
		showNotice(msg.notice);
		showReview(msg.review);
	} else if (msg.type === "review") {
		showReview(msg);
		settingsMsg.textContent = msg.on ? "Review is on for this chat." : "Review is off for this chat.";
	} else if (msg.type === "open") {
		openId = msg.conversationId;
		titleEl.textContent = msg.title;
		status.textContent = "connected";
		ws.send(JSON.stringify({ type: "list" }));
	} else if (msg.type === "chats") renderChats(msg.chats);
	else if (msg.type === "error") {
		status.textContent = "error: " + msg.message;
		settingsMsg.textContent = msg.message;
	} else if (msg.type === "settings") showSettings(msg);
};

const input = document.getElementById("msg");
const send = (whenBusy) => {
	const text = input.value.trim();
	if (!text) return;
	ws.send(JSON.stringify({ type: "submit", content: text, whenBusy }));
	input.value = "";
};
document.getElementById("f").onsubmit = (e) => {
	e.preventDefault();
	send("followUp");
};
document.getElementById("steer").onclick = () => send("steer");
document.getElementById("new").onclick = () => ws.send(JSON.stringify({ type: "new" }));
document.getElementById("stop").onclick = () => ws.send(JSON.stringify({ type: "abort" }));
// Per-chat answer review: the checkbox turns it on, the dropdown picks the reviewer model ("" = the chat's model).
const reviewBox = document.getElementById("review");
const reviewerSelect = document.getElementById("reviewer");
reviewBox.onchange = () => ws.send(JSON.stringify({ type: "review", on: reviewBox.checked }));
reviewerSelect.onchange = () => ws.send(JSON.stringify({ type: "review", reviewerModel: reviewerSelect.value }));
function showReview(r) {
	reviewBox.checked = !!r?.on;
	reviewerSelect.value = r?.reviewerModel ?? "";
}
document.getElementById("compact").onclick = () => ws.send(JSON.stringify({ type: "compact" }));
document.getElementById("reset").onclick = () => {
	const note = prompt("Optional note to carry over into the fresh context (leave empty for none):", "");
	if (note === null) return;
	ws.send(JSON.stringify({ type: "reset", handoff: note.trim() || undefined }));
};

// Settings bar: model and context limit, applied to every chat. The limit is in tokens; the server checks it.
const modelSelect = document.getElementById("model");
const limitInput = document.getElementById("limit");
const maxTurnsInput = document.getElementById("maxturns");
const settingsMsg = document.getElementById("settings-msg");
let current = null;
function showSettings(msg) {
	current = msg;
	modelSelect.textContent = "";
	for (const m of msg.models) {
		const o = document.createElement("option");
		o.value = m.id;
		o.textContent = `${m.name} (${m.contextWindow.toLocaleString("en-US")} window)`;
		modelSelect.appendChild(o);
	}
	reviewerSelect.textContent = "";
	reviewerSelect.appendChild(new Option("Reviewer: same as chat", ""));
	for (const m of msg.models) reviewerSelect.appendChild(new Option(m.name, m.id));
	modelSelect.value = msg.settings.modelId;
	limitInput.value = msg.settings.contextLimit;
	maxTurnsInput.value = msg.settings.maxTurns;
	settingsMsg.textContent = "Saved.";
}
modelSelect.onchange = () => {
	const m = current?.models.find((x) => x.id === modelSelect.value);
	if (m) limitInput.value = m.contextWindow - 16384;
	settingsMsg.textContent = "Not applied yet.";
};
limitInput.oninput = () => (settingsMsg.textContent = "Not applied yet.");
maxTurnsInput.oninput = () => (settingsMsg.textContent = "Not applied yet.");
document.getElementById("settings").onsubmit = (e) => {
	e.preventDefault();
	settingsMsg.textContent = "Applying…";
	ws.send(JSON.stringify({ type: "settings", modelId: modelSelect.value, contextLimit: Number(limitInput.value), maxTurns: Number(maxTurnsInput.value) }));
};
