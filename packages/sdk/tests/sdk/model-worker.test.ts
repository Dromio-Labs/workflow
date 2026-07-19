import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";
import { z } from "zod";

import type { EventPayload } from "@dromio/workflow/core";
import {
  createCodexCliModelWorker,
  createOpenAiCompatibleModelWorker,
  createOpencodeModelWorker,
} from "@dromio/workflow/product";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SDK model workers", () => {
  test("OpenAI-compatible model worker prompts with schema and validates JSON", async () => {
    let requestBody: { messages?: Array<{ content: string; role: string }> } | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as typeof requestBody;
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":true}" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const worker = createOpenAiCompatibleModelWorker({
      baseUrl: "http://localhost:1111",
      model: "test-model",
      provider: "test-provider",
    });

    await expect(worker.completeJson({
      operation: "Worker JSON",
      schema: z.object({ ok: z.boolean() }),
      systemPrompt: "Return an object.",
      userPrompt: "{}",
    })).resolves.toEqual({ ok: true });

    expect(requestBody?.messages?.[0]?.content).toContain("Return only JSON matching this JSON Schema");
    expect(requestBody?.messages?.[0]?.content).toContain("\"ok\"");
  });

  test("opencode model worker parses JSON text and emits model and worker events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workflow-sdk-opencode-model-worker-"));
    const binary = path.join(dir, "stub-opencode");
    const captureFile = path.join(dir, "args.txt");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.CAPTURE_FILE, process.argv.slice(2).join('\\n---ARG---\\n'));",
        "console.error('INFO service=llm providerID=openai modelID=gpt-5.5 session.id=stub stream');",
        "console.log(JSON.stringify({ type: 'step_start', part: { id: 'step-1' } }));",
        "console.log(JSON.stringify({ type: 'message', part: { id: 'msg-1', text: 'checking shape' } }));",
        "console.log(JSON.stringify({ type: 'tool_use', part: { id: 'tool-1', tool: 'read', state: { status: 'completed', input: { filePath: 'README.md' } } } }));",
        "console.log(JSON.stringify({ type: 'message', part: { id: 'msg-2', text: JSON.stringify({ ok: true }) } }));",
        "console.log(JSON.stringify({ type: 'step_finish', part: { id: 'step-1' } }));",
      ].join("\n"),
    );
    await chmod(binary, 0o755);

    const events: EventPayload[] = [];
    const worker = createOpencodeModelWorker({
      binary,
      cwd: dir,
      env: {
        ...process.env,
        CAPTURE_FILE: captureFile,
      },
      timeoutMs: 5000,
    });

    await expect(worker.completeJson({
      onEvent(event) {
        events.push(event);
      },
      operation: "Opencode JSON",
      schema: z.object({ ok: z.boolean() }),
      systemPrompt: "Return an object.",
      userPrompt: "{}",
    })).resolves.toEqual({ ok: true });

    const capturedArgs = await readFile(captureFile, "utf8");
    expect(capturedArgs).toContain("run");
    expect(capturedArgs).toContain("--format");
    expect(capturedArgs).toContain("json");
    expect(capturedArgs).toContain("--print-logs");
    expect(capturedArgs).toContain("Return only JSON matching this JSON Schema");
    expect(capturedArgs).toContain("\"ok\"");

    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "model.request.started",
      "worker.item.started",
      "worker.item.delta",
      "worker.item.completed",
      "model.response.completed",
    ]));
    expect(events.some((event) =>
      event.type === "worker.item.completed" &&
      (event as { itemKind?: string }).itemKind === "tool_call"
    )).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      detail: expect.objectContaining({
        model: "gpt-5.5",
        provider: "openai",
        resolvedModel: "openai/gpt-5.5",
        worker: "opencode",
      }),
      type: "model.request.started",
    }));
  });

  test("Codex CLI model worker runs codex exec with schema and parses the last message", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workflow-sdk-codex-model-worker-"));
    const binary = path.join(dir, "stub-codex");
    const captureFile = path.join(dir, "codex-args.json");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const args = process.argv.slice(2);",
        "const outputIndex = args.indexOf('--output-last-message');",
        "const outputFile = args[outputIndex + 1];",
        "const schemaIndex = args.indexOf('--output-schema');",
        "const schemaFile = args[schemaIndex + 1];",
        "let stdin = '';",
        "process.stdin.on('data', (chunk) => stdin += String(chunk));",
        "process.stdin.on('end', () => {",
        "  const schema = schemaFile ? JSON.parse(fs.readFileSync(schemaFile, 'utf8')) : undefined;",
        "  fs.writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ args, schema, stdin }, null, 2));",
        "  fs.writeFileSync(outputFile, JSON.stringify({ ok: true }));",
        "});",
      ].join("\n"),
    );
    await chmod(binary, 0o755);

    const events: EventPayload[] = [];
    const worker = createCodexCliModelWorker({
      approvalPolicy: "never",
      binary,
      cwd: dir,
      env: {
        ...process.env,
        CAPTURE_FILE: captureFile,
      },
      model: "codex-test-model",
      sandbox: "workspace-write",
      timeoutMs: 5000,
    });

    await expect(worker.completeJson({
      onEvent(event) {
        events.push(event);
      },
      operation: "Codex JSON",
      schema: z.object({ ok: z.boolean(), note: z.string().optional() }),
      systemPrompt: "Return an object.",
      userPrompt: "{}",
    })).resolves.toEqual({ ok: true });

    const captured = JSON.parse(await readFile(captureFile, "utf8")) as {
      args: string[];
      schema?: { required?: string[] };
      stdin: string;
    };
    expect(captured.args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
    expect(captured.args).toContain("--output-schema");
    expect(captured.args).toContain("--output-last-message");
    expect(captured.args).toContain("codex-test-model");
    expect(captured.schema?.required).toEqual(["ok", "note"]);
    expect(captured.stdin).toContain("Return only JSON matching this JSON Schema");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "model.request.started",
      "model.response.completed",
    ]));
  });
});
