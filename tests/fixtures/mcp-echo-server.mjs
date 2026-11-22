// Tiny stdio MCP server for tests: newline-delimited JSON-RPC. Tools: echo(text), add(a, b), env(name).
import { createInterface } from "node:readline";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const tools = [
	{ name: "echo", description: "Returns the text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
	{ name: "add", description: "Adds two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
	{ name: "env", description: "Reads one environment variable", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
];

createInterface({ input: process.stdin }).on("line", (line) => {
	const msg = JSON.parse(line);
	if (msg.id === undefined) return; // notifications need no reply
	const text = (t) => ({ content: [{ type: "text", text: t }], isError: false });
	if (msg.method === "initialize") {
		return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo-fixture", version: "1.0.0" } } });
	}
	if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
	if (msg.method === "tools/call") {
		const { name, arguments: a = {} } = msg.params;
		if (name === "echo") return send({ jsonrpc: "2.0", id: msg.id, result: text(String(a.text)) });
		if (name === "add") return send({ jsonrpc: "2.0", id: msg.id, result: text(String(a.a + a.b)) });
		if (name === "env") return send({ jsonrpc: "2.0", id: msg.id, result: text(String(process.env[a.name] ?? "")) });
	}
	send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
});
