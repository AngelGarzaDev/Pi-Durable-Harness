// Live check for goal 8.5 (needs a running app and a real model call, dev only). It adds a stdio MCP fixture that the
// runner starts from /workspace/mcp-live/echo-server.mjs, asks claude-haiku-5-5 to call its echo tool, and prints the
// tool calls and results. Usage: APP_TOKEN_FILE=secrets/app_token node scripts/live-mcp-check.mjs
import WebSocket from "ws";
import { readFileSync } from "node:fs";
const base = process.env.APP_URL ?? "http://127.0.0.1:8787";
const token = readFileSync(process.env.APP_TOKEN_FILE ?? "secrets/app_token", "utf8").trim();
const login = await fetch(base + "/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
let view = null; const errors = []; const mcpReplies = [];
ws.on("message", (d) => {
	const m = JSON.parse(d);
	if (m.type === "view") view = m.view;
	if (m.type === "error") errors.push(m.message);
	if (m.type === "mcp") mcpReplies.push(m);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (o) => ws.send(JSON.stringify(o));
await new Promise((r) => ws.on("open", r)); await wait(1500);
send({ type: "new" }); await wait(1500);
send({ type: "settings", modelId: "claude-haiku-5-5", contextLimit: 100000, maxTurns: 10 }); await wait(1500);
send({ type: "mcp-add", name: "echo", config: { command: "node", args: ["/workspace/mcp-live/echo-server.mjs"] } }); await wait(4000);
const added = mcpReplies.at(-1)?.servers.find((s) => s.name === "echo");
console.log("mcp echo:", JSON.stringify(added ?? null));
send({ type: "submit", content: "Use the echo tool from the echo MCP server to echo the text live-check-7731. Then reply with only the echoed text." });
await wait(90000);
for (const e of view.entries) {
	const kind = e.kind.replace("pi.", "");
	if (kind === "system") continue;
	const body = (e.model ?? []).map((x) => (typeof x.content === "string" ? x.content : (x.content ?? []).map((b) => b.text ?? b.name ?? "").join(""))).join(" | ");
	console.log(kind, "::", body.slice(0, 300), e.data ? JSON.stringify(e.data).slice(0, 300) : "");
}
console.log("errors:", JSON.stringify(errors));
ws.close();
