// The web search built-in: Pi's pi-web-access run as an MCP server named "web" (see src/web-search.ts). No internet
// needed: these tests only list tools and check the manager's rules. Checks that the four tools arrive as
// mcp__web__*, that the built-in child gets a minimal environment, and that mcp.json cannot override or remove it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "@earendil-works/pi-durable";
import { McpManager } from "../src/mcp.ts";
import { webSearchServer, WEB_SEARCH_SERVER } from "../src/web-search.ts";

const toolNames = (r: ReturnType<typeof createRegistry>) => r.snapshot().tools().map((x) => x.tool.name);

test("the web built-in starts with its four tools under mcp__web__", async () => {
	const dir = mkdtempSync(join(tmpdir(), "web-search-"));
	const path = join(dir, "mcp.json");
	writeFileSync(path, JSON.stringify({ mcpServers: {} }));
	const registry = createRegistry();
	const mcp = new McpManager(registry, path, "http://127.0.0.1:9", "t".repeat(48), [webSearchServer(dir)]);
	try {
		const errors = await mcp.start();
		assert.deepEqual(errors, []);
		const status = mcp.list().find((s) => s.name === WEB_SEARCH_SERVER);
		assert.equal(status?.state, "ready", status?.error);
		assert.equal(status?.kind, "builtin");
		assert.equal(status?.toolCount, 4);
		const names = toolNames(registry).sort();
		for (const t of ["web_search", "fetch_content", "get_search_content", "source_check"]) assert.ok(names.includes(`mcp__web__${t}`), `missing ${t}`);
	} finally {
		await mcp.stopAll();
	}
});

test("the built-in child gets only its own environment and a data-dir home", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-search-env-"));
	const b = webSearchServer(dir);
	assert.deepEqual(Object.keys(b.env).sort(), ["HOME", "PATH", "PI_CODING_AGENT_DIR", "PI_WEB_ACCESS_CACHE_ROOT"]);
	assert.equal(b.env.HOME, join(dir, "web-access"));
	assert.equal(b.env.PI_CODING_AGENT_DIR, join(dir, "web-access"));
	assert.ok(!JSON.stringify(b.env).includes("ANTHROPIC"));
});

test("mcp.json cannot add, replace or remove the built-in name", async () => {
	const dir = mkdtempSync(join(tmpdir(), "web-search-reserved-"));
	const path = join(dir, "mcp.json");
	writeFileSync(path, JSON.stringify({ mcpServers: { web: { url: "http://127.0.0.1:9/mcp" } } }));
	const registry = createRegistry();
	const mcp = new McpManager(registry, path, "http://127.0.0.1:9", "t".repeat(48), [webSearchServer(dir)]);
	try {
		const errors = await mcp.start();
		assert.ok(errors.some((e) => e.includes('"web" is a built-in server name')), errors.join(" | "));
		assert.equal(mcp.list().find((s) => s.name === "web")?.kind, "builtin");
		assert.match((await mcp.add("web", { url: "http://127.0.0.1:9/mcp" })) ?? "", /built-in/);
		assert.match((await mcp.remove("web")) ?? "", /cannot be removed/);
		assert.equal(mcp.list().find((s) => s.name === "web")?.kind, "builtin");
		assert.match(readFileSync(path, "utf8"), /"web"/, "mcp.json entry is left alone");
	} finally {
		await mcp.stopAll();
	}
});
