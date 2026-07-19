import { spawn } from "node:child_process";
import readline from "node:readline";
import {
	type EventPayload,
	type TraceAttributeValue,
	workerItemEvent,
} from "../../core/index.js";
import {
	type InferOperationContractSource,
	normalizeOperationContract,
	type OperationContractSourceLike,
	parseOperationContract,
} from "../../core/prompted-operation/contracts.js";
import { parseJsonObjectFromText } from "../../core/prompted-operation/json-output.js";
import {
	type ModelWorkerCompleteInput,
	type ModelWorkerPort,
	modelWorkerPromptText,
} from "./model-worker.js";
import { runScopedModelWorkerChild } from "./scoped-worker-child.js";

export type OpencodeModelWorkerConfig = {
	binary?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	model?: string;
	skipPermissions?: boolean;
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 240_000;

type ResolvedOpenCodeModel = {
	modelID: string;
	providerID: string;
};

export class OpencodeModelWorker implements ModelWorkerPort {
	private readonly binary: string;
	private readonly cwd: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly model?: string;
	private readonly skipPermissions: boolean;
	private readonly timeoutMs: number;

	constructor(config: OpencodeModelWorkerConfig = {}) {
		this.binary =
			config.binary ?? process.env.OPENCODE_BIN?.trim() ?? "opencode";
		this.cwd = config.cwd ?? process.cwd();
		this.env = config.env ?? process.env;
		this.model = config.model;
		this.skipPermissions =
			config.skipPermissions ??
			process.env.INTENT_OPENCODE_SKIP_PERMISSIONS === "true";
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	complete(input: ModelWorkerCompleteInput) {
		return this.run(input);
	}

	async completeJson<TSchema extends OperationContractSourceLike>(
		input: ModelWorkerCompleteInput & { schema: TSchema },
	): Promise<InferOperationContractSource<TSchema>>;
	async completeJson(input: ModelWorkerCompleteInput): Promise<unknown>;
	async completeJson(input: ModelWorkerCompleteInput) {
		const json = parseJsonObjectFromText(
			await this.complete(input),
			input.operation,
		);
		if (!input.schema) return json;
		return parseOperationContract(
			normalizeOperationContract(
				`${slug(input.operation)}.response`,
				input.schema,
			),
			json,
		);
	}

	private async run(input: ModelWorkerCompleteInput) {
		const prompt = modelWorkerPromptText(input);
		const spanId =
			input.trace?.spanId ?? `model:opencode:${slug(input.operation)}`;
		const traceId = input.trace?.traceId ?? "opencode";
		const model = this.model ?? "";
		const attributes = {
			binary: this.binary,
			cwd: this.cwd,
			model,
			operation: input.operation,
			provider: "opencode",
		};
		let resolvedModel: ResolvedOpenCodeModel | undefined;
		let resolvedEventQueue = Promise.resolve();
		const resolvedAttributes = (resolved: ResolvedOpenCodeModel) => ({
			...attributes,
			model: resolved.modelID,
			opencodeModel: model || "default",
			provider: resolved.providerID,
			resolvedModel: `${resolved.providerID}/${resolved.modelID}`,
			worker: "opencode",
		});
		const emitResolvedModel = (resolved: ResolvedOpenCodeModel) => {
			if (resolvedModel) return;
			resolvedModel = resolved;
			const nextAttributes = resolvedAttributes(resolved);
			resolvedEventQueue = resolvedEventQueue
				.then(() =>
					emitModelEvent(input, {
						detail: nextAttributes,
						message: `Resolved ${input.operation} to ${resolved.providerID}/${resolved.modelID}.`,
						trace: modelTrace({
							attributes: nextAttributes,
							input,
							spanId,
							status: "unset",
							traceId,
						}),
						type: "model.request.started",
					}),
				)
				.catch(() => undefined);
		};

		await emitModelEvent(input, {
			detail: attributes,
			message: `Started ${input.operation}.`,
			trace: modelTrace({
				attributes,
				input,
				spanId,
				status: "unset",
				traceId,
			}),
			type: "model.request.started",
		});

		let content = "";
		try {
			content = await this.runPrompt(input, prompt, emitResolvedModel);
			await resolvedEventQueue;
		} catch (error) {
			await resolvedEventQueue;
			const message = error instanceof Error ? error.message : String(error);
			await emitFailure(
				input,
				spanId,
				traceId,
				resolvedModel ? resolvedAttributes(resolvedModel) : attributes,
				message,
			);
			throw setupError(input, message);
		}

		if (!content.trim()) {
			const message = "opencode completed without message content";
			await emitFailure(input, spanId, traceId, attributes, message);
			throw setupError(input, message);
		}

		await emitModelEvent(input, {
			detail: {
				delta: content,
				length: content.length,
			},
			message: `Received ${input.operation} delta.`,
			trace: modelTrace({
				attributes: {
					...(resolvedModel ? resolvedAttributes(resolvedModel) : attributes),
					contentLength: content.length,
				},
				input,
				spanId,
				status: "unset",
				traceId,
			}),
			type: "model.response.delta",
		});
		await emitModelEvent(input, {
			detail: {
				contentLength: content.length,
			},
			message: `Completed ${input.operation}.`,
			trace: modelTrace({
				attributes: {
					...(resolvedModel ? resolvedAttributes(resolvedModel) : attributes),
					contentLength: content.length,
				},
				input,
				spanId,
				status: "ok",
				traceId,
			}),
			type: "model.response.completed",
		});

		return content;
	}

	private async runPrompt(
		input: ModelWorkerCompleteInput,
		prompt: string,
		onResolvedModel?: (model: ResolvedOpenCodeModel) => void,
	) {
		const args = ["run", prompt, "--format", "json", "--print-logs"];
		if (this.skipPermissions) args.push("--dangerously-skip-permissions");
		if (this.model) args.push("--model", this.model);

		const emitter = createOpencodeWorkerEventEmitter(input, prompt);
		let timedOut = false;

		try {
			return await runScopedModelWorkerChild({
				onTimeout: async (error) => {
					timedOut = true;
					await emitter.emitFailure(error.message);
					await emitter.flush();
				},
				spawnChild: () =>
					spawn(this.binary, args, {
						cwd: this.cwd,
						env: this.env,
						stdio: ["ignore", "pipe", "pipe"],
					}),
				timeoutMessage: `opencode timed out after ${this.timeoutMs}ms`,
				timeoutMs: this.timeoutMs,
				use: (child) =>
					new Promise<string>((resolve, reject) => {
						let cleaned = false;
						let settled = false;
						let rawStdout = "";
						let rawStderr = "";
						const textParts: string[] = [];
						const stdoutRl = readline.createInterface({ input: child.stdout });
						const stderrRl = readline.createInterface({ input: child.stderr });

						const cleanup = () => {
							if (cleaned) return;
							cleaned = true;
							stdoutRl.close();
							stderrRl.close();
							child.off("close", onClose);
							child.off("error", onError);
						};
						const fail = async (error: Error) => {
							if (settled || timedOut) return;
							settled = true;
							await emitter.emitFailure(error.message);
							await emitter.flush();
							cleanup();
							reject(error);
						};
						const succeed = async (value: string) => {
							if (settled || timedOut) return;
							settled = true;
							await emitter.flush();
							cleanup();
							resolve(value);
						};
						const onClose = (
							code: number | null,
							signal: NodeJS.Signals | null,
						) => {
							if (timedOut) {
								cleanup();
								return;
							}
							void (async () => {
								const text =
									textParts.join("").trim() ||
									rawStdout.trim() ||
									rawStderr.trim();
								if (code !== 0) {
									await fail(
										new Error(
											`opencode failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${truncateLog(text)}`,
										),
									);
									return;
								}
								await succeed(text);
							})();
						};
						const onError = (error: Error) => {
							if (timedOut) {
								cleanup();
								return;
							}
							void fail(enrichOpenCodeSetupError(error, this.binary));
						};

						stdoutRl.on("line", (line) => {
							rawStdout += `${line}\n`;
							try {
								const event = JSON.parse(line) as unknown;
								emitter.handle(event);
								const text = readOpenCodeTextPart(event);
								if (text) textParts.push(text);
							} catch {
								// Non-JSON stdout is still captured for final text extraction.
							}
						});
						stderrRl.on("line", (line) => {
							rawStderr += `${line}\n`;
							const resolved = readOpenCodeResolvedModelLog(line);
							if (resolved) onResolvedModel?.(resolved);
						});
						child.on("error", onError);
						child.on("close", onClose);
					}),
			});
		} finally {
			emitter.cancel();
		}
	}
}

export function createOpencodeModelWorker(
	config: OpencodeModelWorkerConfig = {},
): ModelWorkerPort {
	return new OpencodeModelWorker(config);
}

function createOpencodeWorkerEventEmitter(
	input: ModelWorkerCompleteInput,
	prompt: string,
) {
	let queue = Promise.resolve();

	const emit = (event: EventPayload) => {
		queue = queue.then(() => input.onEvent?.(event)).catch(() => undefined);
	};

	const makeEvent = (
		type:
			| "worker.item.completed"
			| "worker.item.delta"
			| "worker.item.failed"
			| "worker.item.started",
		itemId: string,
		itemKind: string,
		title: string,
		preview: string,
		options: {
			error?: string;
			input?: unknown;
			output?: unknown;
			parentItemId?: string;
			providerRefs?: Record<string, string | undefined>;
			raw?: unknown;
			rawType?: string;
			text?: string;
		} = {},
	) =>
		workerItemEvent({
			type,
			provider: "opencode",
			itemId,
			itemKind,
			operation: input.operation,
			title,
			preview: oneLine(preview),
			...(options.parentItemId ? { parentItemId: options.parentItemId } : {}),
			...(options.providerRefs ? { providerRefs: options.providerRefs } : {}),
			...(options.text ? { text: options.text } : {}),
			...(options.input === undefined
				? {}
				: { input: boundedRaw(options.input) }),
			...(options.output === undefined
				? {}
				: { output: boundedRaw(options.output) }),
			...(options.rawType ? { rawType: options.rawType } : {}),
			...(options.raw === undefined ? {} : { raw: boundedRaw(options.raw) }),
			...(options.error ? { error: oneLine(options.error) } : {}),
		});

	return {
		handle(event: unknown) {
			if (!isRecord(event)) return;
			const eventType = typeof event.type === "string" ? event.type : "unknown";
			const part = isRecord(event.part) ? event.part : {};
			const itemId = readItemId(event, part);
			const providerRefs = readProviderRefs(event, part);
			const parentItemId =
				typeof part.messageID === "string" ? part.messageID : undefined;

			if (eventType === "step_start") {
				emit(
					makeEvent(
						"worker.item.started",
						itemId,
						"model_step",
						`${input.operation} started a model step`,
						`${input.operation} started a model step`,
						{
							input: { message: prompt },
							parentItemId,
							providerRefs,
							raw: event,
							rawType: eventType,
						},
					),
				);
				return;
			}
			if (eventType === "step_finish") {
				emit(
					makeEvent(
						"worker.item.completed",
						itemId,
						"model_step",
						`${input.operation} finished a model step`,
						`${input.operation} finished a model step`,
						{ parentItemId, providerRefs, raw: event, rawType: eventType },
					),
				);
				return;
			}
			if (eventType === "tool_use" || part.type === "tool") {
				const tool = typeof part.tool === "string" ? part.tool : "tool";
				const state = isRecord(part.state) ? part.state : {};
				const status =
					typeof state.status === "string" ? state.status : "running";
				const error = typeof state.error === "string" ? state.error : undefined;
				const mappedType =
					status === "error"
						? "worker.item.failed"
						: status === "completed" || status === "success"
							? "worker.item.completed"
							: "worker.item.started";
				const verb =
					mappedType === "worker.item.failed"
						? "failed"
						: mappedType === "worker.item.completed"
							? "completed"
							: "is using";
				const preview = `${input.operation} ${verb} ${tool}`;
				emit(
					makeEvent(mappedType, itemId, "tool_call", preview, preview, {
						error,
						input: state.input,
						output: state.output,
						parentItemId,
						providerRefs,
						raw: event,
						rawType: eventType,
					}),
				);
				return;
			}

			const text = readOpenCodeTextPart(event);
			if (text) {
				emit(
					makeEvent(
						"worker.item.delta",
						itemId,
						"assistant_message",
						`${input.operation} wrote output`,
						text,
						{
							parentItemId,
							providerRefs,
							raw: event,
							rawType: eventType,
							text,
						},
					),
				);
			}
		},
		async emitFailure(message: string) {
			emit(
				makeEvent(
					"worker.item.failed",
					`failure-${Date.now()}`,
					"model_step",
					`${input.operation} failed`,
					`${input.operation} failed: ${message}`,
					{
						error: message,
						raw: { message },
						rawType: "worker.failure",
						text: message,
					},
				),
			);
		},
		async flush() {
			await queue;
		},
		cancel() {
			// No timers to clear in the generic SDK emitter.
		},
	};
}

function readItemId(
	event: Record<string, unknown>,
	part: Record<string, unknown>,
): string {
	for (const value of [
		part.id,
		part.callID,
		part.messageID,
		event.id,
		event.timestamp,
	]) {
		if (typeof value === "string" && value) return value;
		if (typeof value === "number") return String(value);
	}
	return `item-${crypto.randomUUID()}`;
}

function readProviderRefs(
	event: Record<string, unknown>,
	part: Record<string, unknown>,
) {
	const metadata = isRecord(part.metadata) ? part.metadata : {};
	const openai = isRecord(metadata.openai) ? metadata.openai : {};
	const refs: Record<string, string | undefined> = {};
	if (typeof event.sessionID === "string") refs.sessionId = event.sessionID;
	if (typeof part.sessionID === "string") refs.sessionId = part.sessionID;
	if (typeof part.messageID === "string") refs.messageId = part.messageID;
	if (typeof part.id === "string") refs.partId = part.id;
	if (typeof part.callID === "string") refs.callId = part.callID;
	if (typeof openai.itemId === "string") refs.itemId = openai.itemId;
	return Object.keys(refs).length ? refs : undefined;
}

function readOpenCodeTextPart(event: unknown): string | null {
	if (!isRecord(event)) return null;
	const part = event.part;
	if (!isRecord(part)) return null;
	if (typeof part.text === "string") return part.text;
	if (typeof part.content === "string") return part.content;
	if (Array.isArray(part.content)) {
		const text = part.content
			.map((item) => {
				if (typeof item === "string") return item;
				if (isRecord(item) && typeof item.text === "string") return item.text;
				return "";
			})
			.join("");
		return text || null;
	}
	return null;
}

function readOpenCodeResolvedModelLog(
	line: string,
): ResolvedOpenCodeModel | undefined {
	if (!line.includes("service=llm")) return undefined;
	const fields = new Map<string, string>();
	for (const match of line.matchAll(
		/(?:^|\s)(providerID|modelID)=(?:"([^"]+)"|(\S+))/g,
	)) {
		fields.set(match[1]!, match[2] ?? match[3] ?? "");
	}
	const providerID = fields.get("providerID");
	const modelID = fields.get("modelID");
	if (!providerID || !modelID) return undefined;
	return { modelID, providerID };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedRaw(value: unknown): unknown {
	const text = JSON.stringify(value);
	if (text.length <= 12000) return value;
	return { truncated: true, preview: `${text.slice(0, 11997)}...` };
}

function oneLine(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 240
		? `${normalized.slice(0, 237)}...`
		: normalized;
}

function truncateLog(value: string): string {
	return value.length > 4000
		? `${value.slice(0, 4000)}\n...<truncated>`
		: value;
}

function enrichOpenCodeSetupError(error: Error, binary: string): Error {
	if ("code" in error && error.code === "ENOENT") {
		return new Error(
			[
				`opencode executable was not found: ${binary}`,
				"Install and configure opencode, or set OPENCODE_BIN to the executable path.",
			].join("\n"),
		);
	}
	return error;
}

async function emitFailure(
	input: ModelWorkerCompleteInput,
	spanId: string,
	traceId: string,
	attributes: Record<string, TraceAttributeValue>,
	error: string,
) {
	await emitModelEvent(input, {
		detail: {
			...attributes,
			error,
		},
		message: `Failed ${input.operation}: ${error}`,
		trace: modelTrace({
			attributes,
			input,
			spanId,
			status: "error",
			traceId,
		}),
		type: "model.request.failed",
	});
}

async function emitModelEvent(
	input: ModelWorkerCompleteInput,
	event: EventPayload,
) {
	await input.onEvent?.(event);
}

function modelTrace(input: {
	attributes: Record<string, TraceAttributeValue>;
	input: ModelWorkerCompleteInput;
	spanId: string;
	status: "error" | "ok" | "unset";
	traceId: string;
}) {
	return {
		attributes: input.attributes,
		kind: "client" as const,
		name: input.input.operation,
		parentSpanId: input.input.trace?.parentSpanId,
		spanId: input.spanId,
		status: input.status,
		traceId: input.traceId,
	};
}

function setupError(input: ModelWorkerCompleteInput, cause: string) {
	return new Error(
		input.setupErrorMessage ? input.setupErrorMessage(cause) : cause,
	);
}

function slug(value: string) {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "request"
	);
}
