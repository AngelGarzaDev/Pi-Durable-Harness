// The web search built-in: Pi's pi-web-access package run as an MCP server ("web"), so the model gets
// web_search, fetch_content, get_search_content and source_check as mcp__web__<tool>.
// It runs in the app process (the app already has internet access; the runner does not). Its environment is
// explicit and holds no API key. Its settings and caches live in DATA_DIR/web-access. See docs/NOTES.md.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BuiltinServer } from "./mcp.js";

export const WEB_SEARCH_SERVER = "web";

export function webSearchServer(dataDir: string): BuiltinServer {
	const home = join(dataDir, "web-access");
	mkdirSync(join(home, "cache"), { recursive: true });
	const script = createRequire(import.meta.url).resolve("pi-web-access/dist/mcp-cli.js");
	return {
		name: WEB_SEARCH_SERVER,
		command: process.execPath,
		args: [script],
		// web-search.json (optional) is read from PI_CODING_AGENT_DIR. Keys can go there too; never print them.
		env: {
			PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
			HOME: home,
			PI_CODING_AGENT_DIR: home,
			PI_WEB_ACCESS_CACHE_ROOT: join(home, "cache"),
		},
		description: "Web search and page fetch (Pi's pi-web-access)",
	};
}
