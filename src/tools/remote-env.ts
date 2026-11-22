// App-side ExecutionEnv that forwards file and shell operations to the runner container over HTTP.
// Only the operations the coding tools use are implemented; the rest return a not_supported error.
import type { Context } from "@earendil-works/chord/context";
import {
	err, ok, ExecutionError, FileError, type BinaryReader, type ExecutionEnv, type FileInfo,
	type Result, type ShellExecOptions, type ShellExecResult, type LineScan,
} from "@earendil-works/pi-durable/env";

type Wire<T> = { ok: true; value: T } | { ok: false; error: { kind: "file" | "exec"; code: string; message: string; path?: string; spillPath?: string } };

function decodeError(e: Wire<never> extends infer _ ? { kind: "file" | "exec"; code: string; message: string; path?: string; spillPath?: string } : never) {
	if (e.kind === "exec") {
		const x = new ExecutionError(e.code as ConstructorParameters<typeof ExecutionError>[0], e.message);
		x.spillPath = e.spillPath;
		return x;
	}
	return new FileError(e.code as ConstructorParameters<typeof FileError>[0], e.message, e.path);
}
function decodeValue(v: unknown): unknown {
	if (v && typeof v === "object" && "$bytes" in v) return new Uint8Array(Buffer.from((v as { $bytes: string }).$bytes, "base64"));
	return v;
}
function encodeValue(v: unknown): unknown {
	if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("base64") };
	return v;
}
function fromWire<T>(w: Wire<T>): Result<T, any> {
	return w.ok ? ok(decodeValue(w.value) as T) : err(decodeError(w.error as never));
}

// Refused operations. Typed loosely on purpose: the caller only ever sees a not_supported error.
const notSupported = (name: string) => async (..._args: any[]): Promise<any> =>
	err(new FileError("not_supported", `${name} is not available in the runner yet`));

export class RemoteExecutionEnv implements ExecutionEnv {
	readonly id: string;
	cwd: string;
	constructor(private readonly baseUrl: string, cwd = "/workspace") {
		this.id = `runner:${baseUrl}`;
		this.cwd = cwd;
	}

	private async post<T>(path: string, body: unknown, context?: Context): Promise<Wire<T>> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: context?.abortSignal,
		});
		if (!response.ok) throw new Error(`runner ${path} returned HTTP ${response.status}`);
		return (await response.json()) as Wire<T>;
	}

	private async call<T>(method: string, args: unknown[], context: Context): Promise<Result<T, FileError>> {
		return fromWire(await this.post<T>("/v1/call", { method, args: args.map(encodeValue) }, context));
	}

	absolutePath(path: string, context: Context) { return this.call<string>("absolutePath", [path], context); }
	joinPath(parts: string[], context: Context) { return this.call<string>("joinPath", [parts], context); }
	canonicalPath(path: string, context: Context) { return this.call<string>("canonicalPath", [path], context); }
	exists(path: string, context: Context) { return this.call<boolean>("exists", [path], context); }
	fileInfo(path: string, context: Context) { return this.call<FileInfo>("fileInfo", [path], context); }
	readTextFile(path: string, context: Context) { return this.call<string>("readTextFile", [path], context); }
	writeFile(path: string, content: string | Uint8Array, context: Context) {
		return this.call<void>("writeFile", [path, content], context);
	}

	async openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, context: Context): Promise<Result<BinaryReader, FileError>> {
		const opened = fromWire<{ handle: string }>(await this.post("/v1/reader/open", { path, options }, context));
		if (!opened.ok) return opened as Result<BinaryReader, FileError>;
		const handle = opened.value.handle;
		const op = async <T>(name: string, args: unknown[], ctx: Context): Promise<Result<T, FileError>> =>
			fromWire<T>(await this.post("/v1/reader", { handle, op: name, args: args.map(encodeValue) }, ctx));
		const reader: BinaryReader = {
			info: (ctx) => op<FileInfo>("info", [], ctx),
			read: (offset, length, ctx) => op<Uint8Array>("read", [offset, length], ctx),
			scanLines: (options, ctx) => op<LineScan>("scanLines", [options], ctx),
			close: async (ctx) => void (await op("close", [], ctx)),
		};
		return ok(reader);
	}

	async exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
		const { onOutput, ...rest } = options ?? {};
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		context.abortSignal?.addEventListener("abort", onAbort, { once: true });
		try {
			const response = await fetch(`${this.baseUrl}/v1/exec`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ command, options: { ...rest, onOutput: undefined } }),
				signal: controller.signal,
			});
			if (!response.body) throw new Error("runner exec returned no body");
			const decoder = new TextDecoder();
			let buffered = "";
			for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
				buffered += decoder.decode(chunk, { stream: true });
				let nl: number;
				while ((nl = buffered.indexOf("\n")) >= 0) {
					const line = buffered.slice(0, nl);
					buffered = buffered.slice(nl + 1);
					if (!line.trim()) continue;
					const msg = JSON.parse(line) as { t: "out"; text: string; info: any } | { t: "done"; result: Wire<ShellExecResult> };
					if (msg.t === "out") onOutput?.(msg.text, context, msg.info);
					else {
						const w = msg.result;
						return w.ok ? ok(w.value) : err(decodeError(w.error as never) as ExecutionError);
					}
				}
			}
			return err(new ExecutionError("unknown", "runner closed the connection before the command finished"));
		} catch (error) {
			if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "command aborted"));
			return err(new ExecutionError("unknown", String(error)));
		} finally {
			context.abortSignal?.removeEventListener("abort", onAbort);
		}
	}

	async cleanup(_context: Context): Promise<void> {}

	// Not used by the coding tools; refused explicitly so nothing silently misbehaves.
	readTextLines = notSupported("readTextLines");
	openTextLineReader = notSupported("openTextLineReader");
	readBinaryFile = notSupported("readBinaryFile");
	appendFile = notSupported("appendFile");
	truncateFile = notSupported("truncateFile");
	flushFile = notSupported("flushFile");
	renameFile = notSupported("renameFile");
	listDir = notSupported("listDir");
	openDirReader = notSupported("openDirReader");
	watch = notSupported("watch");
	createDir = notSupported("createDir");
	remove = notSupported("remove");
	createTempDir = notSupported("createTempDir");
	createTempFile = notSupported("createTempFile");
}

