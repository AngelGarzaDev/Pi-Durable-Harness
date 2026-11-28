// Browser client: chat list, transcript, settings, and chat actions (send, steer, fork, reset, compact).
import { reviewLine, isReviewContinuation } from "./review-view.js";
import { keepGoingLine, isKeepGoingContinuation } from "./keep-going-view.js";
import { answerMessage, questionHint } from "./ask-view.js";
import { pushDecisionMessage, pushSummaryLine, commitLine, fileLine } from "./push-view.js";
import { renderMarkdown, enhanceCode } from "./markdown-view.js";
import { groupByFolder } from "./chat-order.js";
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
	if (isReviewContinuation(entry) || isKeepGoingContinuation(entry)) return [];
	const stop = keepGoingLine(entry);
	if (stop) return [{ cls: "review", label: "", text: stop }];
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

// Question cards above the form: one per open ask_user question. Keys already answered stay disabled until the view drops them.
const answered = new Set();
let lastQuestions = [];
const questionsEl = document.getElementById("questions");
// Approval cards for git_push: one per waiting push. Nothing is pushed until Approve is clicked.
const decided = new Set();
let lastPushes = [];
function renderPushes(pushes) {
	questionsEl.querySelectorAll(".push-card").forEach((el) => el.remove());
	for (const p of pushes ?? []) {
		if (decided.has(p.key)) continue;
		const card = document.createElement("div");
		card.className = "question push-card";
		const head = document.createElement("div");
		head.className = "question-text";
		head.textContent = pushSummaryLine(p);
		card.appendChild(head);
		if (p.reason) {
			const why = document.createElement("div");
			why.className = "question-hint";
			why.textContent = `Reason: ${p.reason}`;
			card.appendChild(why);
		}
		const list = document.createElement("pre");
		list.className = "push-list";
		list.textContent = [...(p.commits ?? []).map(commitLine), "", ...(p.files ?? []).map(fileLine)].join("\n");
		card.appendChild(list);
		const row = document.createElement("div");
		row.className = "question-options";
		for (const [label, approve] of [["Approve push", true], ["Reject", false]]) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = label;
			b.onclick = () => {
				const msg = pushDecisionMessage(p, approve);
				if (!msg) return;
				decided.add(p.key);
				ws.send(JSON.stringify(msg));
				renderPushes(lastPushes);
			};
			row.appendChild(b);
		}
		card.appendChild(row);
		questionsEl.prepend(card);
	}
}
function renderQuestions(questions) {
	questionsEl.querySelectorAll(".question:not(.push-card)").forEach((el) => el.remove());
	for (const q of questions ?? []) {
		const card = document.createElement("div");
		card.className = "question";
		const text = document.createElement("div");
		text.className = "question-text";
		text.textContent = q.question;
		const hint = document.createElement("div");
		hint.className = "question-hint";
		hint.textContent = questionHint(q);
		const choices = document.createElement("div");
		choices.className = "question-options";
		const field = document.createElement("div");
		field.className = "question-own";
		const input = document.createElement("input");
		input.type = "text";
		input.maxLength = 2000;
		input.placeholder = "Your own answer";
		const send = document.createElement("button");
		send.textContent = "Send answer";
		const note = document.createElement("div");
		note.className = "question-note";
		const sendAnswer = (text) => {
			const msg = answerMessage(q, text);
			if (!msg) return;
			answered.add(q.key);
			ws.send(JSON.stringify(msg));
			note.textContent = "Sent.";
			card.classList.add("done");
			for (const el of card.querySelectorAll("button, input")) el.disabled = true;
		};
		for (const option of q.options ?? []) {
			const b = document.createElement("button");
			b.className = "option";
			b.textContent = option;
			b.onclick = () => sendAnswer(option);
			choices.appendChild(b);
		}
		send.onclick = () => sendAnswer(input.value);
		input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sendAnswer(input.value); } };
		field.append(input, send);
		card.append(text, hint, choices, field, note);
		if (answered.has(q.key)) {
			card.classList.add("done");
			for (const el of card.querySelectorAll("button, input")) el.disabled = true;
			note.textContent = "Sent.";
		}
		questionsEl.appendChild(card);
	}
}

function render(entries) {
	out.textContent = "";
	for (const e of entries) {
		for (const it of items(e)) {
			const div = document.createElement("div");
			div.className = it.cls;
			if (it.cls === "assistant") {
				const role = document.createElement("div");
				role.className = "role";
				role.textContent = it.label;
				const body = document.createElement("div");
				body.className = "md";
				body.innerHTML = renderMarkdown(it.text);
				enhanceCode(body);
				div.append(role, body);
			} else div.textContent = it.cls === "review" ? it.text : it.text ? `${it.label}: ${it.text}` : it.label;
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

// Folders the person has collapsed in the sidebar (kept in this browser only).
const collapsedKey = "pdw-collapsed-folders";
let collapsed = new Set(JSON.parse(localStorage.getItem(collapsedKey) ?? "[]"));
let lastChats = [];
function renderChats(chats) {
	if (chats) lastChats = chats;
	chatList.textContent = "";
	for (const group of groupByFolder(lastChats)) {
		const hasFolder = group.folder !== "";
		const isCollapsed = hasFolder && collapsed.has(group.folder);
		if (hasFolder) {
			const row = document.createElement("div");
			row.className = "folder-row";
			const h = document.createElement("button");
			h.type = "button";
			h.className = "folder";
			h.setAttribute("aria-expanded", String(!isCollapsed));
			h.textContent = (isCollapsed ? "▸ " : "▾ ") + group.folder;
			h.title = "/workspace/" + group.folder + " · " + group.chats.length + " chat(s)";
			h.onclick = () => {
				if (collapsed.has(group.folder)) collapsed.delete(group.folder);
				else collapsed.add(group.folder);
				localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
				renderChats();
			};
			const plus = document.createElement("button");
			plus.type = "button";
			plus.className = "folder-plus";
			const gear = document.createElement("button");
			gear.type = "button";
			gear.className = "folder-plus folder-gear";
			gear.textContent = "\u2699";
			gear.title = "Settings for /workspace/" + group.folder;
			gear.setAttribute("aria-label", "Settings for " + group.folder);
			gear.onclick = () => openWorkspace(group.folder);
			plus.textContent = "+";
			plus.title = "New chat in /workspace/" + group.folder;
			plus.setAttribute("aria-label", "New chat in " + group.folder);
			plus.onclick = () => ws.send(JSON.stringify({ type: "new", folder: group.folder }));
			row.append(h, gear, plus);
			chatList.appendChild(row);
		}
		if (isCollapsed) continue;
		for (const [c, child] of group.chats) {
			const b = document.createElement("button");
			b.className = "chat" + (child ? " child" : "") + (c.id === openId ? " active" : "") + (hasFolder ? " in-folder" : "");
			b.textContent = (child ? "↳ " : "") + c.title;
			b.title = c.title;
			b.onclick = () => ws.send(JSON.stringify({ type: "open", conversationId: c.id }));
			chatList.appendChild(b);
		}
	}
}

ws.onopen = () => {
	status.textContent = "connected";
	ws.send(JSON.stringify({ type: "auth-status" }));
	ws.send(JSON.stringify({ type: "mcp-list" }));
	ws.send(JSON.stringify({ type: "secrets-list" }));
};
ws.onclose = () => (status.textContent = "disconnected, reload to reconnect");
ws.onmessage = (e) => {
	const msg = JSON.parse(e.data);
	if (msg.type === "view") {
		render(msg.view.entries);
		showNotice(msg.notice);
		showReview(msg.review);
		showKeepGoing(msg.keepGoing);
		lastQuestions = msg.questions ?? [];
		renderQuestions(lastQuestions);
		lastPushes = msg.pushes ?? [];
		renderPushes(lastPushes);
	} else if (msg.type === "push-result") {
		if (!msg.ok) {
			decided.delete(msg.key);
			status.textContent = msg.error;
			renderPushes(lastPushes);
		}
	} else if (msg.type === "answer-result") {
		if (!msg.ok) {
			answered.delete(msg.key);
			status.textContent = msg.error;
			renderQuestions(lastQuestions);
		}
	} else if (msg.type === "review") {
		showReview(msg);
		settingsMsg.textContent = msg.on ? "Review is on for this chat." : "Review is off for this chat.";
	} else if (msg.type === "keepgoing") {
		showKeepGoing(msg);
		settingsMsg.textContent = msg.on ? "Keep going is on for this chat." : "Keep going is off for this chat.";
	} else if (msg.type === "open") {
		openId = msg.conversationId;
		// Opening a chat in a collapsed folder shows that folder, so the open chat is never hidden.
		if (msg.folder && collapsed.delete(msg.folder)) localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
		titleEl.textContent = msg.title;
		instrText.value = msg.instructions ?? "";
		instrMsg.textContent = "";
		status.textContent = msg.folder ? "connected · folder " + msg.folder : "connected";
		newMsg.textContent = "";
		ws.send(JSON.stringify({ type: "list" }));
	} else if (msg.type === "chats") renderChats(msg.chats);
	else if (msg.type === "error") {
		status.textContent = "error: " + msg.message;
		newMsg.textContent = msg.message;
		settingsMsg.textContent = msg.message;
		keyMsg.textContent = msg.message;
		mcpMsg.textContent = msg.message;
		secretsMsg.textContent = msg.message;
		if (msg.message.startsWith("Enter the app token") || msg.message.startsWith("That is not")) secretsNote.textContent = msg.message;
		instrMsg.textContent = msg.message;
		if (wsdlg.open) {
			wsCfgMsg.textContent = msg.message;
			wsAgentsMsg.textContent = msg.message;
		}
	} else if (msg.type === "chat-instructions") {
		instrText.value = msg.instructions ?? "";
		instrMsg.textContent = msg.instructions ? "Saved. Applies from the next request." : "Cleared for this chat.";
	} else if (msg.type === "workspace") showWorkspace(msg);
	else if (msg.type === "workspace-agents") showWorkspaceAgents(msg);
	else if (msg.type === "settings") showSettings(msg);
	else if (msg.type === "auth") showKey(msg.anthropic);
	else if (msg.type === "mcp") showMcp(msg);
	else if (msg.type === "secrets") showSecrets(msg);
	else if (msg.type === "api-keys") {
		showApiKeys(msg.keys);
		voiceMsg.textContent = "";
	} else if (msg.type === "api-key-created") {
		voiceKey.value = msg.key;
		voiceNew.hidden = false;
		voiceLabel.value = "";
		voiceMsg.textContent = "Key created.";
	} else if (msg.type === "api-key-error") voiceMsg.textContent = msg.message;
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

// File uploads. The server saves each file under a safe name and returns its path in the workspace.
// A whole folder is limited by its total size, not its file count. Files are still sent one request each.
const MAX_FOLDER_BYTES = 2 * 1024 * 1024 * 1024;
let uploadCancelled = false;
function cancelUpload() {
	uploadCancelled = true;
}
for (const b of document.querySelectorAll(".uploadcancel")) b.onclick = cancelUpload;
function setUploadBusy(busy) {
	for (const b of document.querySelectorAll(".uploadcancel")) b.hidden = !busy;
}
// rel: the file's path inside a picked folder (sent as x-relative-path so the server creates the folders).
// stageId: when set, the file goes into the folder's staging area instead of its final place (see uploadFolder).
async function uploadFile(file, query, rel, stageId) {
	const headers = { "x-file-name": encodeURIComponent(file.name) };
	if (rel !== undefined) headers["x-relative-path"] = encodeURIComponent(rel);
	if (stageId !== undefined) headers["x-staging-id"] = stageId;
	const r = await fetch("/upload?" + query, { method: "POST", headers, body: file });
	return r.json().catch(() => ({ ok: false, error: "Upload failed." }));
}
async function postStage(route, query) {
	const r = await fetch("/upload/" + route + "?" + query, { method: "POST" });
	return r.json().catch(() => ({ ok: false, error: "Upload failed." }));
}
// Uploads a picked folder all or nothing. Files go into a staging folder in the workspace (.staging/<id>/).
// The folder is moved into place only after every file arrived (commit, which may add -2 to the name on a clash).
// If a file fails or the user cancels, the staging folder is removed, so nothing partial is left in the workspace.
// Returns saved, failed, top, folderPath (the final folder, when committed), cancelled, skipped, and error (if refused).
async function uploadFolder(files, query, onProgress) {
	const list = Array.from(files);
	const bytes = list.reduce((sum, f) => sum + f.size, 0);
	if (bytes > MAX_FOLDER_BYTES) return { saved: 0, failed: [], error: "The folder is " + (bytes / 1024 ** 3).toFixed(2) + " GB, over the 2 GB limit. Upload part of it." };
	const top = list.length ? list[0].webkitRelativePath.split("/")[0] : "";
	const failed = [];
	if (!list.length) return { saved: 0, failed, top, folderPath: "", cancelled: false, skipped: 0 };
	uploadCancelled = false;
	setUploadBusy(true);
	let i = 0;
	let folderPath = "";
	let error = "";
	try {
		const started = await postStage("start", query);
		if (!started.ok) return { saved: 0, failed, top, folderPath, cancelled: false, skipped: list.length, error: started.error || "Upload failed." };
		const id = started.id;
		for (; i < list.length; i++) {
			if (uploadCancelled) break;
			onProgress(i + 1, list.length);
			const f = list[i];
			const res = await uploadFile(f, query, f.webkitRelativePath || f.name, id);
			if (!res.ok) {
				failed.push(f.webkitRelativePath || f.name);
				error = res.error || "Upload failed.";
				break;
			}
		}
		if (i < list.length || failed.length) {
			await postStage("cancel", query + "&id=" + id);
		} else {
			onProgress(list.length, list.length);
			const done = await postStage("commit", query + "&id=" + id + "&top=" + encodeURIComponent(top));
			if (done.ok) folderPath = done.path;
			else {
				error = done.error || "Could not finish the folder upload.";
				await postStage("cancel", query + "&id=" + id);
			}
		}
	} finally {
		setUploadBusy(false);
	}
	const cancelled = uploadCancelled && i < list.length;
	const saved = folderPath ? list.length : 0;
	return { saved, failed, top, folderPath, cancelled, skipped: folderPath ? 0 : list.length, error: folderPath ? "" : error };
}
function folderSummary(res) {
	if (res.error) return res.error;
	const more = res.failed.length ? " Failed: " + res.failed.slice(0, 5).join(", ") + (res.failed.length > 5 ? " and more" : "") + "." : "";
	if (res.cancelled) return "Upload cancelled; nothing was saved from " + res.top + ".";
	return "Saved " + res.saved + " file(s) from " + res.top + " as " + res.folderPath + "." + more;
}
document.getElementById("attach").onclick = () => document.getElementById("attachfile").click();
document.getElementById("attachdir").onclick = () => document.getElementById("attachdirpick").click();
document.getElementById("attachfile").onchange = async (e) => {
	const files = Array.from(e.target.files);
	e.target.value = "";
	if (!files.length) return;
	if (openId === null) return showNotice("Open a chat before uploading a file.");
	const paths = [];
	const failed = [];
	for (const file of files) {
		showNotice("Uploading " + file.name + "…");
		const res = await uploadFile(file, "chat=" + openId);
		if (res.ok) paths.push(res.path);
		else failed.push(file.name + ": " + res.error);
	}
	if (paths.length) input.value = (input.value.trim() ? input.value.trimEnd() + " " : "") + paths.join(" ");
	showNotice(failed.length ? failed.join(" ") : "Uploaded " + paths.length + " file(s). Their paths are in your message.");
	input.focus();
};
document.getElementById("attachdirpick").onchange = async (e) => {
	const files = e.target.files;
	e.target.value = "";
	if (!files || !files.length) return;
	if (openId === null) return showNotice("Open a chat before uploading a folder.");
	const res = await uploadFolder(files, "chat=" + openId, (n, total) => showNotice("Uploading folder: " + n + " of " + total + "…"));
	if (res.error) return showNotice(res.error);
	if (res.saved && res.folderPath) input.value = (input.value.trim() ? input.value.trimEnd() + " " : "") + res.folderPath;
	showNotice(folderSummary(res));
	input.focus();
};
const wsUploadMsg = document.getElementById("wsuploadmsg");
document.getElementById("wsupload").onchange = async (e) => {
	const files = Array.from(e.target.files);
	e.target.value = "";
	if (!files.length || !wsFolder) return;
	const saved = [];
	const failed = [];
	for (const file of files) {
		wsUploadMsg.textContent = "Uploading " + file.name + "…";
		const res = await uploadFile(file, "folder=" + encodeURIComponent(wsFolder));
		if (res.ok) saved.push(res.path);
		else failed.push(file.name + ": " + res.error);
	}
	wsUploadMsg.textContent = failed.length ? failed.join(" ") : "Saved " + saved.length + " file(s).";
};
document.getElementById("wsuploaddir").onchange = async (e) => {
	const files = e.target.files;
	e.target.value = "";
	if (!files || !files.length || !wsFolder) return;
	const res = await uploadFolder(files, "folder=" + encodeURIComponent(wsFolder), (n, total) => {
		wsUploadMsg.textContent = "Uploading folder: " + n + " of " + total + "…";
	});
	wsUploadMsg.textContent = res.error || folderSummary(res);
};
const newFolder = document.getElementById("newfolder");
const newMsg = document.getElementById("newmsg");
document.getElementById("new").onclick = () => {
	const folder = newFolder.value.trim();
	newMsg.textContent = folder ? "Creating folder…" : "";
	ws.send(JSON.stringify({ type: "new", folder }));
};
document.getElementById("logout").onclick = async () => {
	await fetch("/logout", { method: "POST" });
	location.href = "/login";
};
document.getElementById("stop").onclick = () => ws.send(JSON.stringify({ type: "abort" }));
// Per-chat answer review: the checkbox turns it on, the dropdown picks the reviewer model ("" = the chat's model).
const reviewBox = document.getElementById("review");
const reviewerSelect = document.getElementById("reviewer");
reviewBox.onchange = () => ws.send(JSON.stringify({ type: "review", on: reviewBox.checked }));
reviewerSelect.onchange = () => ws.send(JSON.stringify({ type: "review", reviewerModel: reviewerSelect.value }));

// Keep going: the loop continues an answer until it ends with DONE, up to the chosen cap. Per chat.
const keepBox = document.getElementById("keepgoing");
const keepMax = document.getElementById("keepmax");
keepBox.onchange = () => ws.send(JSON.stringify({ type: "keepgoing", on: keepBox.checked }));
keepMax.onchange = () => ws.send(JSON.stringify({ type: "keepgoing", maxContinues: Number(keepMax.value) }));
function showKeepGoing(k) {
	keepBox.checked = !!k?.on;
	keepMax.value = String(k?.maxContinues ?? 5);
}
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

// Global settings dialog.
const globalDlg = document.getElementById("globaldlg");
document.getElementById("globalbtn").onclick = () => {
	globalDlg.showModal();
	ws.send(JSON.stringify({ type: "api-keys-get" }));
};

// Home Assistant voice keys (in the global settings dialog). The plain key appears once, in voicenew.
const voiceKeys = document.getElementById("voicekeys");
const voiceForm = document.getElementById("voicekeyform");
const voiceLabel = document.getElementById("voicelabel");
const voiceMsg = document.getElementById("voicemsg");
const voiceNew = document.getElementById("voicenew");
const voiceKey = document.getElementById("voicekey");
function showApiKeys(keys) {
	voiceKeys.textContent = "";
	if (keys.length === 0) voiceKeys.innerHTML = '<li class="muted">No keys yet.</li>';
	for (const k of keys) {
		const li = document.createElement("li");
		const text = document.createElement("span");
		text.textContent = k.label + " · created " + new Date(k.createdAt).toLocaleString() + " ";
		const revoke = document.createElement("button");
		revoke.type = "button";
		revoke.textContent = "Revoke";
		revoke.onclick = () => {
			if (!confirm("Revoke the key \"" + k.label + "\"? Home Assistant stops working with it.")) return;
			ws.send(JSON.stringify({ type: "api-key-revoke", id: k.id }));
		};
		li.append(text, revoke);
		voiceKeys.appendChild(li);
	}
}
voiceForm.onsubmit = (e) => {
	e.preventDefault();
	voiceMsg.textContent = "Creating…";
	ws.send(JSON.stringify({ type: "api-key-create", label: voiceLabel.value }));
};
document.getElementById("voicecopy").onclick = () => {
	voiceKey.select();
	navigator.clipboard?.writeText(voiceKey.value).then(() => (voiceMsg.textContent = "Copied."), () => (voiceMsg.textContent = "Select the key and copy it."));
};
document.getElementById("voicehide").onclick = () => {
	voiceKey.value = "";
	voiceNew.hidden = true;
};
document.getElementById("globalclose").onclick = () => globalDlg.close();

// Workspace settings dialog: one per /workspace/<folder>, opened from the folder's gear button.
const wsdlg = document.getElementById("wsdlg");
const wsTitle = document.getElementById("wstitle");
const wsModel = document.getElementById("wsmodel");
const wsLimit = document.getElementById("wslimit");
const wsMaxTurns = document.getElementById("wsmaxturns");
const wsMcp = document.getElementById("wsmcp");
const wsCfgMsg = document.getElementById("wscfgmsg");
const wsVoice = document.getElementById("wsvoice");
const wsAgents = document.getElementById("wsagents");
const wsAgentsMsg = document.getElementById("wsagentsmsg");
let wsFolder = "";
let wsMcpNames = [];
function openWorkspace(folder) {
	wsFolder = folder;
	wsTitle.textContent = "Workspace /workspace/" + folder;
	wsAgents.value = "";
	wsAgentsMsg.textContent = "Loading…";
	wsCfgMsg.textContent = "";
	wsMcp.textContent = "Loading…";
	fillWsModels();
	wsdlg.showModal();
	ws.send(JSON.stringify({ type: "workspace-get", folder }));
	ws.send(JSON.stringify({ type: "workspace-agents-get", folder }));
}
function fillWsModels() {
	wsModel.textContent = "";
	wsModel.appendChild(new Option("Global default", ""));
	for (const m of current?.models ?? []) wsModel.appendChild(new Option(m.name, m.id));
}
function showWorkspace(msg) {
	if (msg.folder !== wsFolder) return;
	const cfg = msg.config ?? {};
	fillWsModels();
	wsModel.value = cfg.modelId ?? "";
	wsLimit.value = cfg.contextLimit ?? "";
	wsMaxTurns.value = cfg.maxTurns ?? "";
	wsLimit.placeholder = current ? "global " + current.settings.contextLimit : "global";
	wsMaxTurns.placeholder = current ? "global " + current.settings.maxTurns : "global";
	wsVoice.checked = cfg.voiceTools === true;
	const off = new Set(cfg.disabledMcp ?? []);
	wsMcpNames = msg.mcp.map((s) => s.name);
	wsMcp.textContent = "";
	if (wsMcpNames.length === 0) wsMcp.textContent = "No MCP servers configured.";
	for (const s of msg.mcp) {
		const label = document.createElement("label");
		label.className = "wsmcp-row";
		const box = document.createElement("input");
		box.type = "checkbox";
		box.value = s.name;
		box.checked = !off.has(s.name);
		label.append(box, " " + s.name + " (" + s.state + ")");
		wsMcp.appendChild(label);
	}
	wsCfgMsg.textContent = msg.warning ? msg.warning : "";
}
function showWorkspaceAgents(msg) {
	if (msg.folder !== wsFolder) return;
	wsAgents.value = msg.found ? msg.text : "";
	wsAgentsMsg.textContent = msg.found ? "" : "No AGENTS.md in this folder yet.";
}
document.getElementById("wsclose").onclick = () => wsdlg.close();
document.getElementById("wssaveall").onclick = () => {
	document.getElementById("wscfgform").requestSubmit();
	document.getElementById("wsagentsform").requestSubmit();
};
document.getElementById("wscfgform").onsubmit = (e) => {
	e.preventDefault();
	const disabledMcp = [...wsMcp.querySelectorAll("input[type=checkbox]")].filter((b) => !b.checked).map((b) => b.value);
	const config = {
		modelId: wsModel.value || null,
		contextLimit: wsLimit.value === "" ? null : Number(wsLimit.value),
		maxTurns: wsMaxTurns.value === "" ? null : Number(wsMaxTurns.value),
		disabledMcp,
		voiceTools: wsVoice.checked,
	};
	wsCfgMsg.textContent = "Saving…";
	ws.send(JSON.stringify({ type: "workspace-config", folder: wsFolder, config }));
};
document.getElementById("wsagentsform").onsubmit = (e) => {
	e.preventDefault();
	wsAgentsMsg.textContent = "Writing…";
	ws.send(JSON.stringify({ type: "workspace-agents-save", folder: wsFolder, text: wsAgents.value }));
};
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
const instrText = document.getElementById("instrtext");
const instrMsg = document.getElementById("instrmsg");
document.getElementById("instrform").onsubmit = (e) => {
	e.preventDefault();
	instrMsg.textContent = "Saving…";
	ws.send(JSON.stringify({ type: "chat-instructions", text: instrText.value }));
};
document.getElementById("settings").onsubmit = (e) => {
	e.preventDefault();
	settingsMsg.textContent = "Applying…";
	ws.send(JSON.stringify({ type: "settings", modelId: modelSelect.value, contextLimit: Number(limitInput.value), maxTurns: Number(maxTurnsInput.value) }));
};

// Anthropic key from the browser. The server never sends the key back, only where it comes from and its last four characters.
const keySource = document.getElementById("keysource");
const keyInput = document.getElementById("keyinput");
const keyMsg = document.getElementById("keymsg");
const keyClear = document.getElementById("keyclear");
function showKey(info) {
	const label = { browser: `entered in browser (${info.hint ?? ""})`, secret: "Docker secret", none: "none set" }[info.source] ?? info.source;
	keySource.textContent = label;
	keyClear.disabled = info.source !== "browser";
	keyMsg.textContent = "";
}
document.getElementById("keyform").onsubmit = (e) => {
	e.preventDefault();
	const key = keyInput.value.trim();
	if (!key) return (keyMsg.textContent = "Enter a key first.");
	keyMsg.textContent = "Saving…";
	ws.send(JSON.stringify({ type: "auth-set", key }));
	keyInput.value = "";
};
keyClear.onclick = () => {
	if (!confirm("Remove the key entered in the browser? The Docker secret is used again if there is one.")) return;
	ws.send(JSON.stringify({ type: "auth-clear" }));
};

// Secrets panel. Names and times only; the server never sends a value. Every change needs a recent app-token check.
const secretsList = document.getElementById("secretslist");
const secretsForm = document.getElementById("secretsform");
const secretsMsg = document.getElementById("secretsmsg");
const secretsNote = document.getElementById("secretsnote");
const secretsReauth = document.getElementById("secretsreauth");
function showSecrets(info) {
	secretsList.replaceChildren();
	if (!info.available) {
		secretsNote.textContent = "The secret store is off on this host: the master key file is missing. Run the one-time host setup (docs/DESIGN.md).";
		secretsReauth.hidden = true;
		secretsForm.hidden = true;
		return;
	}
	for (const s of info.names) {
		const li = document.createElement("li");
		li.textContent = `${s.name}  (set ${new Date(s.updatedAt).toLocaleString()})`;
		const del = document.createElement("button");
		del.type = "button";
		del.textContent = "Remove";
		del.disabled = !info.reauthed;
		del.onclick = () => {
			if (!confirm(`Remove the secret "${s.name}"?`)) return;
			ws.send(JSON.stringify({ type: "secrets-remove", name: s.name }));
		};
		li.append(" ", del);
		secretsList.append(li);
	}
	secretsReauth.hidden = info.reauthed;
	secretsForm.hidden = !info.reauthed;
	secretsNote.textContent = info.reauthed ? "Unlocked. Changes allowed until the window closes." : "Enter the app token to change secrets. Changes need a fresh token within 5 minutes.";
	secretsMsg.textContent = "";
}
secretsReauth.onsubmit = (e) => {
	e.preventDefault();
	const token = document.getElementById("secretstoken").value;
	document.getElementById("secretstoken").value = "";
	ws.send(JSON.stringify({ type: "secrets-reauth", token }));
};
secretsForm.onsubmit = (e) => {
	e.preventDefault();
	const name = document.getElementById("secretname").value.trim();
	const value = document.getElementById("secretvalue").value;
	document.getElementById("secretvalue").value = "";
	secretsMsg.textContent = "Saving…";
	ws.send(JSON.stringify({ type: "secrets-set", name, value }));
};

// MCP servers panel. Text is set with textContent only; server names and errors come from the server.
const mcpList = document.getElementById("mcplist");
const mcpErrors = document.getElementById("mcperrors");
const mcpMsg = document.getElementById("mcpmsg");
let mcpConfigs = {};
let mcpEditing = null; // name of the server being edited, or null when adding
function setMcpEditing(name) {
	mcpEditing = name;
	document.getElementById("mcpname").readOnly = !!name;
	document.getElementById("mcpsubmit").textContent = name ? "Save changes" : "Add server";
	document.getElementById("mcpcancel").hidden = !name;
	if (!name) for (const id of ["mcpname", "mcptarget", "mcpargs"]) document.getElementById(id).value = "";
}
document.getElementById("mcpcancel").onclick = () => { setMcpEditing(null); mcpMsg.textContent = ""; };
function editMcp(name) {
	const cfg = mcpConfigs[name] ?? {};
	setMcpEditing(name);
	document.getElementById("mcpname").value = name;
	document.getElementById("mcptarget").value = cfg.url ?? cfg.command ?? "";
	document.getElementById("mcpargs").value = Array.isArray(cfg.args) ? cfg.args.join(" ") : "";
	mcpMsg.textContent = "Editing. Headers and env are kept as they are.";
	document.getElementById("mcptarget").focus();
}
function showMcp(info) {
	mcpConfigs = info.configs ?? {};
	document.getElementById("mcpcount").textContent = info.servers.length ? `(${info.servers.length})` : "";
	mcpList.replaceChildren();
	for (const s of info.servers) {
		const li = document.createElement("li");
		const text = document.createElement("span");
		text.textContent = `${s.name} · ${s.kind} · ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"} · `;
		const state = document.createElement("span");
		state.className = "state-" + s.state;
		state.textContent = s.state + (s.error ? `: ${s.error}` : "");
		const edit = document.createElement("button");
		edit.type = "button";
		edit.textContent = "Edit";
		edit.onclick = () => editMcp(s.name);
		const reconnect = document.createElement("button");
		reconnect.type = "button";
		reconnect.textContent = "Reconnect";
		reconnect.onclick = () => ws.send(JSON.stringify({ type: "mcp-reconnect", name: s.name }));
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "Remove";
		remove.onclick = () => {
			if (confirm(`Remove MCP server "${s.name}"?`)) ws.send(JSON.stringify({ type: "mcp-remove", name: s.name }));
		};
		li.append(text, state, edit, reconnect, remove);
		mcpList.appendChild(li);
	}
	if (!info.servers.length) mcpList.textContent = "No servers yet.";
	mcpErrors.textContent = info.configErrors.length ? "Problems in mcp.json: " + info.configErrors.join("; ") : "";
	mcpMsg.textContent = "";
}
document.getElementById("mcpform").onsubmit = (e) => {
	e.preventDefault();
	const name = document.getElementById("mcpname").value.trim();
	const target = document.getElementById("mcptarget").value.trim();
	const args = document.getElementById("mcpargs").value.trim();
	if (!name || !target) return (mcpMsg.textContent = "Enter a name and a URL or program.");
	const isUrl = /^https?:\/\//.test(target);
	// When editing, keep the other fields (headers, env, flags) and replace only the target and arguments.
	const base = mcpEditing ? { ...(mcpConfigs[mcpEditing] ?? {}) } : {};
	delete base.url; delete base.command; delete base.args;
	const config = isUrl
		? { ...base, url: target }
		: { ...base, command: target, ...(args ? { args: args.split(/\s+/) } : {}) };
	mcpMsg.textContent = mcpEditing ? "Saving…" : "Connecting…";
	ws.send(JSON.stringify({ type: mcpEditing ? "mcp-update" : "mcp-add", name, config }));
	if (mcpEditing) setMcpEditing(null);
	else for (const id of ["mcpname", "mcptarget", "mcpargs"]) document.getElementById(id).value = "";
};
