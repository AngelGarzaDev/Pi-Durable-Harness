import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addServer, checkServer, readMcpConfig, removeServer } from "../src/mcp-config.ts";

const dir = () => mkdtempSync(join(tmpdir(), "mcp-cfg-"));

test("a stdio entry and an http entry both validate", () => {
	const stdio = checkServer("fs", { command: "node", args: ["x.js"], timeout: 30 });
	assert.ok("entry" in stdio, JSON.stringify(stdio));
	assert.equal(stdio.entry.config.command, "node");
	const http = checkServer("docs", { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } });
	assert.ok("entry" in http, JSON.stringify(http));
});

test("names must match [A-Za-z0-9_-] and be at most 40 characters", () => {
	assert.match((checkServer("bad name", { command: "x" }) as { error: string }).error, /letters, digits/);
	assert.match((checkServer("a.b", { command: "x" }) as { error: string }).error, /letters, digits/);
	assert.match((checkServer("x".repeat(41), { command: "x" }) as { error: string }).error, /max 40/);
	assert.ok("entry" in checkServer("ok_name-1", { command: "x" }));
});

test("an entry needs exactly one of command or url", () => {
	assert.match((checkServer("both", { command: "x", url: "https://a" }) as { error: string }).error, /exactly one/);
	assert.match((checkServer("neither", { args: [] }) as { error: string }).error, /exactly one/);
	assert.match((checkServer("str", "node") as { error: string }).error, /must be an object/);
});

test("a bad http url is refused by the Pi validator", () => {
	const r = checkServer("h", { url: "not a url" });
	assert.ok("error" in r);
});

test("readMcpConfig: missing file is empty, bad JSON and bad entries are reported, good entries still load", () => {
	const d = dir();
	const p = join(d, "mcp.json");
	assert.deepEqual(readMcpConfig(p), { entries: [], errors: [] });
	writeFileSync(p, "{ nope");
	assert.match(readMcpConfig(p).errors[0], /not valid JSON/);
	writeFileSync(p, JSON.stringify({ mcpServers: { good: { command: "node" }, "bad name": { command: "x" } } }));
	const r = readMcpConfig(p);
	assert.deepEqual(r.entries.map((e) => e.name), ["good"]);
	assert.equal(r.errors.length, 1);
});

test("addServer refuses duplicates unless replace, removeServer removes, file is mode 600 JSON", () => {
	const d = dir();
	const p = join(d, "mcp.json");
	assert.equal(addServer(p, "one", { command: "node" }), undefined);
	assert.match(addServer(p, "one", { command: "other" }) ?? "", /already exists/);
	assert.equal(addServer(p, "one", { command: "other" }, true), undefined);
	assert.equal(JSON.parse(readFileSync(p, "utf8")).mcpServers.one.command, "other");
	assert.match(addServer(p, "two", { command: "a", url: "https://b" }) ?? "", /exactly one/);
	assert.equal(removeServer(p, "one"), undefined);
	assert.match(removeServer(p, "one") ?? "", /No server named/);
	assert.deepEqual(readMcpConfig(p).entries, []);
});
