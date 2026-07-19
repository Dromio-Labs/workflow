import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EventPayload } from "../../core/index.js";
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
	modelWorkerJsonSchema,
	modelWorkerPromptText,
} from "./model-worker.js";
import { runScopedModelWorkerChild } from "./scoped-worker-child.js";

export type CodexCliModelWorkerConfig = {
	approvalPolicy?: "never" | "on-request" | "untrusted";
	binary?: string;
	bypassApprovalsAndSandbox?: boolean;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	extraArgs?: string[];
	model?: string;
	profile?: string;
	sandbox?: "danger-full-access" | "read-only" | "workspace-write";
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 600_000;

export class CodexCliModelWorker implements ModelWorkerPort {
	private readonly approvalPolicy?: CodexCliModelWorkerConfig["approvalPolicy"];
	private readonly binary: string;
	private readonly bypassApprovalsAndSandbox: boolean;
	private readonly cwd: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly extraArgs: string[];
	private readonly model?: string;
	private readonly profile?: string;
	private readonly sandbox?: CodexCliModelWorkerConfig["sandbox"];
	private readonly timeoutMs: number;

	constructor(config: CodexCliModelWorkerConfig = {}) {
		this.approvalPolicy = config.approvalPolicy;
		this.binary = config.binary ?? process.env.CODEX_BIN?.trim() ?? "codex";
		this.bypassApprovalsAndSandbox = config.bypassApprovalsAndSandbox ?? false;
		this.cwd = config.cwd ?? process.cwd();
		this.env = config.env ?? process.env;
		this.extraArgs = config.extraArgs ?? [];
		this.model = config.model;
		this.profile = config.profile;
		this.sandbox = config.sandbox;
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
			input.trace?.spanId ?? `model:codex:${slug(input.operation)}`;
		const traceId = input.trace?.traceId ?? "codex-cli";
		const attributes = {
			binary: this.binary,
			cwd: this.cwd,
			model: this.model ?? "",
			operation: input.operation,
			provider: "codex-cli",
		};
		await emitModelEvent(input, {
			detail: attributes,
			message: `Started ${input.operation}.`,
			stepId: input.trace?.parentSpanId?.match(/^step:(.+):attempt:\d+$/)?.[1],
			trace: {
				attributes,
				kind: "producer",
				name: input.operation,
				parentSpanId: input.trace?.parentSpanId,
				spanId,
				status: "unset",
				traceId,
			},
			type: "model.request.started",
		});

		let content = "";
		try {
			content = await this.runPrompt(input, prompt);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await emitFailure(input, spanId, traceId, attributes, message);
			throw new Error(
				input.setupErrorMessage?.(message) ??
					`${input.operation} failed: ${message}`,
			);
		}

		if (!content.trim()) {
			const message = "codex completed without message content";
			await emitFailure(input, spanId, traceId, attributes, message);
			throw new Error(
				input.setupErrorMessage?.(message) ??
					`${input.operation} failed: ${message}`,
			);
		}

		await emitModelEvent(input, {
			detail: {
				contentLength: content.length,
			},
			message: `Completed ${input.operation}.`,
			trace: {
				attributes: {
					...attributes,
					contentLength: content.length,
				},
				kind: "producer",
				name: input.operation,
				parentSpanId: input.trace?.parentSpanId,
				spanId,
				status: "ok",
				traceId,
			},
			type: "model.response.completed",
		});
		return content;
	}

	private async runPrompt(input: ModelWorkerCompleteInput, prompt: string) {
		const tempDir = await mkdtemp(
			path.join(tmpdir(), "workflow-sdk-codex-worker-"),
		);
		const outputFile = path.join(tempDir, "last-message.txt");
		const schemaFile = path.join(tempDir, "schema.json");
		const jsonSchema = codexCliOutputSchema(modelWorkerJsonSchema(input));
		if (jsonSchema) {
			await writeFile(schemaFile, JSON.stringify(jsonSchema, null, 2));
		}
		const args = [
			...(this.approvalPolicy
				? ["--ask-for-approval", this.approvalPolicy]
				: []),
			"exec",
			"--cd",
			this.cwd,
			"--color",
			"never",
			"--output-last-message",
			outputFile,
		];
		if (jsonSchema) args.push("--output-schema", schemaFile);
		if (this.model) args.push("--model", this.model);
		if (this.profile) args.push("--profile", this.profile);
		if (this.sandbox) args.push("--sandbox", this.sandbox);
		if (this.bypassApprovalsAndSandbox)
			args.push("--dangerously-bypass-approvals-and-sandbox");
		args.push(...this.extraArgs, "-");

		try {
			const fallback = await runScopedModelWorkerChild({
				spawnChild: () =>
					spawn(this.binary, args, {
						cwd: this.cwd,
						env: this.env,
						stdio: ["pipe", "pipe", "pipe"],
					}),
				timeoutMessage: `codex timed out after ${this.timeoutMs}ms`,
				timeoutMs: this.timeoutMs,
				use: (child) =>
					new Promise<string>((resolve, reject) => {
						let settled = false;
						let stdout = "";
						let stderr = "";
						const fail = (error: Error) => {
							if (settled) return;
							settled = true;
							cleanup();
							reject(error);
						};
						const onClose = (
							code: number | null,
							signal: NodeJS.Signals | null,
						) => {
							if (settled) return;
							settled = true;
							cleanup();
							if (code !== 0) {
								reject(
									new Error(
										`codex failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${truncateLog(stderr || stdout)}`,
									),
								);
								return;
							}
							resolve(stdout.trim() || stderr.trim());
						};
						const onError = (error: Error) => {
							fail(enrichCodexSetupError(error, this.binary));
						};
						const onStderr = (chunk: Buffer | string) => {
							stderr += String(chunk);
						};
						const onStdout = (chunk: Buffer | string) => {
							stdout += String(chunk);
						};
						const cleanup = () => {
							child.stdout.off("data", onStdout);
							child.stderr.off("data", onStderr);
							child.off("close", onClose);
							child.off("error", onError);
						};
						child.stdout.on("data", onStdout);
						child.stderr.on("data", onStderr);
						child.on("error", onError);
						child.on("close", onClose);
						child.stdin.end(prompt);
					}),
			});
			const content = await readFile(outputFile, "utf8").catch(() => fallback);
			return content.trim() || fallback.trim();
		} finally {
			await rm(tempDir, { force: true, recursive: true });
		}
	}
}

export function createCodexCliModelWorker(
	config: CodexCliModelWorkerConfig = {},
): ModelWorkerPort {
	return new CodexCliModelWorker(config);
}

async function emitModelEvent(
	input: ModelWorkerCompleteInput,
	event: EventPayload,
) {
	await input.onEvent?.(event);
}

async function emitFailure(
	input: ModelWorkerCompleteInput,
	spanId: string,
	traceId: string,
	attributes: Record<string, string>,
	message: string,
) {
	await emitModelEvent(input, {
		detail: {
			...attributes,
			error: message,
		},
		message,
		trace: {
			attributes,
			kind: "producer",
			name: input.operation,
			parentSpanId: input.trace?.parentSpanId,
			spanId,
			status: "error",
			traceId,
		},
		type: "model.request.failed",
	});
}

function enrichCodexSetupError(error: Error, binary: string) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") return error;
	return new Error(
		[
			`codex executable was not found: ${binary}`,
			"Install and configure Codex CLI, or set CODEX_BIN to the executable path.",
		].join("\n"),
	);
}

function truncateLog(value: string, max = 2000) {
	const text = value.trim();
	if (text.length <= max) return text;
	return `[truncated first ${text.length - max} chars]\n${text.slice(-max)}`;
}

function slug(value: string) {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "operation"
	);
}

function codexCliOutputSchema(schema: unknown): unknown {
	if (!schema) return schema;
	return normalizeCodexCliOutputSchema(schema);
}

function normalizeCodexCliOutputSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(normalizeCodexCliOutputSchema);
	if (!isRecord(schema)) return schema;

	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		next[key] = normalizeCodexCliOutputSchema(value);
	}

	const properties = isRecord(next.properties) ? next.properties : undefined;
	if (
		properties &&
		(next.type === "object" || typeof next.type === "undefined")
	) {
		next.required = Object.keys(properties);
	}

	return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
