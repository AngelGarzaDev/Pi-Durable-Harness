import { readFileSync } from "node:fs";

// All runtime settings come from env vars. The API key is read from a file (Docker secret), never from an env var.
export interface Config {
	host: string;
	port: number;
	dataDir: string;
	apiKeyFile: string;
	model: string;
	runnerUrl: string;
	runnerTokenFile: string;
	tokenFile: string;
}

export function loadConfig(env = process.env): Config {
	return {
		host: env.HOST ?? "127.0.0.1",
		port: Number(env.PORT ?? 8787),
		dataDir: env.DATA_DIR ?? "./data",
		apiKeyFile: env.ANTHROPIC_API_KEY_FILE ?? "/run/secrets/anthropic_api_key",
		model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
		runnerUrl: env.RUNNER_URL ?? "http://127.0.0.1:7000",
		runnerTokenFile: env.RUNNER_TOKEN_FILE ?? "/run/secrets/runner_token",
		tokenFile: env.APP_TOKEN_FILE ?? "/run/secrets/app_token",
	};
}

// Shared secret the app sends to the runner. Read once at startup, never logged.
export function readRunnerToken(path: string): string {
	const token = readFileSync(path, "utf8").trim();
	if (token.length < 32) throw new Error(`Runner token at ${path} is missing or too short (need at least 32 characters)`);
	return token;
}

// Reads the key once at startup. Returns the trimmed value and never logs it.
export function readApiKey(path: string): string {
	const key = readFileSync(path, "utf8").trim();
	if (!key.startsWith("sk-ant-")) throw new Error(`Secret at ${path} is empty or not an Anthropic API key`);
	return key;
}
