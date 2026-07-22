import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  catalog,
  defineSignal,
  runWorkflowCli,
  step,
  UnknownWorkflowRouteError,
  workflow,
  workflowApp,
} from "../../src/sdk/index.js";
import {
  ask,
  defineScorePolicy,
  goto,
  loop,
  promptedOperationEvaluationSchema,
} from "@dromio/workflow/core";
import type { ModelWorkerPort } from "@dromio/workflow/product";
import { z } from "zod";

describe("root workflow authoring", () => {
  test("separates reusable definition identity from runtime placement", async () => {
    const events: string[] = [];
    const writeMessage = step({
      id: "example.write-message",
      input: { message: z.string() },
      output: { written: z.string() },
      sideEffects: ["filesystem.write"],
      run({ artifacts, input }) {
        artifacts.file({ mediaType: "text/plain", path: "/tmp/message.txt" });
        return { written: input.message };
      },
    });
    const workflowCatalog = catalog([writeMessage]);
    const runtimeStep = workflowCatalog.createStep(writeMessage.id, {
      stepId: "write-placement",
    });
    const workflow = loop({ id: "authoring-test", steps: [runtimeStep] });

    const session = await workflow.start({ message: "hello" }, {
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(writeMessage.id).toBe("example.write-message");
    expect(runtimeStep.id).toBe("write-placement");
    expect(session.state.written).toBe("hello");
    expect(events).toContain("artifact.created");
    expect(workflowCatalog.search({ sideEffects: ["filesystem.write"] })[0]?.item.id)
      .toBe("example.write-message");
  });

  test("resolves typed defaults with placement config once", async () => {
    let resolved = 0;
    const configured = step({
      config: {
        defaults: { nested: { prefix: "Default", suffix: "!" } },
        resolve(defaults, placement) {
          resolved += 1;
          const nested = placement.nested as Partial<typeof defaults.nested> | undefined;
          return {
            nested: { ...defaults.nested, ...nested },
          };
        },
      },
      id: "example.configured",
      input: { message: z.string() },
      output: { result: z.string() },
      run({ config, input }) {
        return { result: `${config.nested.prefix}:${input.message}${config.nested.suffix}` };
      },
    });
    const runtimeStep = configured.create({
      config: { nested: { prefix: "Placement" } },
      stepId: "configured-placement",
    });
    const session = await loop({ id: "configured-workflow", steps: [runtimeStep] })
      .start({ message: "hello" });

    expect(configured.id).toBe("example.configured");
    expect(runtimeStep.id).toBe("configured-placement");
    expect(session.state.result).toBe("Placement:hello!");
    expect(resolved).toBe(1);
  });

  test("asks, validates, and maps a human answer through step.ask", async () => {
    const answerAudience = step.ask({
      answer: z.string().trim().min(1),
      id: "example.ask-audience",
      input: { prompt: z.string() },
      mapAnswer: ({ answer, input, question }) => ({
        clarification: `${question.prompt} ${answer} for ${input.prompt}`,
      }),
      output: { clarification: z.string() },
      question: ({ input }) => ({
        id: "audience",
        prompt: `Who should receive ${input.prompt}?`,
        title: "Audience",
        type: "text",
      }),
    });
    const authoredWorkflow = loop({
      id: "ask-audience",
      steps: [answerAudience.create()],
    });
    const session = await authoredWorkflow.start({ prompt: "the update" });

    expect(answerAudience.kind).toBe("question");
    expect(answerAudience.sideEffects).toEqual(["human.input"]);
    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions).toEqual([{
      id: "audience",
      prompt: "Who should receive the update?",
      title: "Audience",
      type: "text",
    }]);

    await session.answer({ questionId: "audience", value: " developers " });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.clarification).toBe(
      "Who should receive the update? developers for the update",
    );

    const invalid = await authoredWorkflow.start({ prompt: "the update" });
    await invalid.answer({ questionId: "audience", value: " " });
    await expect(invalid.resume()).rejects.toThrow(
      "Operation contract example.ask-audience.answer failed",
    );
  });

  test("declares a typed signal and suspends through step.waitFor", async () => {
    const paymentConfirmed = defineSignal({
      correlation: z.object({ orderId: z.string() }),
      id: "payment.confirmed",
      payload: z.object({ transactionId: z.string() }),
      title: "Payment confirmed",
    });
    const waitForPayment = step.waitFor({
      correlation: ({ input }) => ({ orderId: input.orderId }),
      id: "orders.wait-for-payment",
      input: { orderId: z.string() },
      signal: paymentConfirmed,
    });
    const runtime = loop({
      id: "wait-for-payment",
      steps: [waitForPayment.create()],
    });
    const session = await runtime.start({ orderId: "order-123" });

    expect(session.status).toBe("waiting");
    expect(waitForPayment.signals?.map((signal) => signal.id)).toEqual([
      "payment.confirmed",
    ]);
    expect(session.pendingHooks[0]).toMatchObject({
      id: "payment.confirmed",
      input: {
        correlation: { orderId: "order-123" },
        signalId: "payment.confirmed",
      },
      kind: "signal",
    });

    await session.resumeHook({
      token: session.pendingHooks[0]!.token,
      value: {
        occurrenceId: "occ-123",
        occurredAt: "2026-07-14T15:30:00.000Z",
        payload: { transactionId: "txn-456" },
      },
    });
    await session.resume();

    expect(session.state.payload).toEqual({ transactionId: "txn-456" });
  });

  test("creates a fresh signal hook when a workflow loops back to the same wait step", async () => {
    const sourceChanged = defineSignal({
      correlation: z.object({ runId: z.string() }),
      id: "source.changed",
      payload: z.object({ sequence: z.number() }),
      title: "Source changed",
    });
    const waitForSource = step.waitFor({
      correlation: ({ input }) => ({ runId: input.runId }),
      id: "notes.wait-for-source",
      input: { runId: z.string() },
      signal: sourceChanged,
    });
    const routeBack = step({
      id: "notes.route-back",
      input: { payload: z.object({ sequence: z.number() }) },
      output: {},
      run() {
        return goto("notes.wait-for-source");
      },
    });
    const authoredWorkflow = workflow({
      catalog: [waitForSource, routeBack],
      document: {
        id: "notes.repeated-signals",
        label: "Repeated signals",
        version: 1,
        trigger: { id: "start", type: "manual", input: { runId: { jsonSchema: { type: "string" } } } },
        nodes: [
          { id: waitForSource.id, catalogItemId: waitForSource.id },
          { id: routeBack.id, catalogItemId: routeBack.id },
        ],
        edges: [
          { id: "start-wait", source: "start", target: waitForSource.id },
          { id: "wait-route", source: waitForSource.id, target: routeBack.id },
          { id: "route-end", source: routeBack.id, target: "end" },
        ],
        loops: [{ id: "listen", label: "Listen", start: waitForSource.id, end: routeBack.id, backTo: waitForSource.id }],
        end: { id: "end", type: "result", output: {} },
      },
      input: { runId: z.string() },
      output: {},
    });
    const session = await authoredWorkflow.start({ runId: "run-1" });
    const firstToken = session.pendingHooks[0]!.token;

    await session.resumeHook({
      token: firstToken,
      value: { occurrenceId: "occ-1", occurredAt: "2026-07-15T03:00:00.000Z", payload: { sequence: 1 } },
    });

    expect(session.status).toBe("waiting");
    expect(session.pendingHooks[0]!.token).not.toBe(firstToken);
    expect(session.pendingHooks[0]!.token).toContain(":2:");
  });

  test("delegates typed work through a durable handoff and preserves correction", async () => {
    const research = step.delegate({
      artifacts: ({ input }) => [{
        artifactId: "brief-1",
        kind: "brief",
        title: input.topic,
        uri: "artifact://brief-1",
      }],
      capabilities: ["browser", "search", "future-capability"],
      context: ({ input }) => ({ locale: "en-GB", topic: input.topic }),
      id: "research.competitors",
      input: { topic: z.string() },
      instructions: ({ input }) => `Research competitors for ${input.topic}.`,
      output: { report: z.string().min(3) },
      summary: ({ input }) => `Research ${input.topic}`,
      title: "Competitor research",
    });
    const session = await loop({
      id: "delegation-test",
      steps: [research.create({ stepId: "research" })],
    }).start({ topic: "durable workflows" }, { runId: "run-delegation" });

    expect(research.kind).toBe("delegate");
    expect(research.sideEffects).toEqual(["external.harness.delegation"]);
    expect(session.status).toBe("waiting");
    expect(session.pendingHooks[0]).toMatchObject({
      id: "research.competitors",
      input: {
        artifacts: [{ artifactId: "brief-1", kind: "brief" }],
        attempt: 1,
        capabilities: ["browser", "search", "future-capability"],
        context: { locale: "en-GB", topic: "durable workflows" },
        instructions: "Research competitors for durable workflows.",
        outputSchema: {
          additionalProperties: false,
          required: ["report"],
          type: "object",
        },
        runId: "run-delegation",
        stepId: "research",
        summary: "Research durable workflows",
        title: "Competitor research",
        workflowId: "delegation-test",
      },
      kind: "handoff_requested",
      schema: {
        additionalProperties: false,
        required: ["report"],
        type: "object",
      },
      title: "Competitor research",
      token: "hook:run-delegation:research:1:0:research_competitors",
    });
    const token = session.pendingHooks[0]!.token;

    await expect(session.resumeHook({ token, value: { report: 1 } })).rejects.toThrow(
      "output does not match its schema",
    );
    expect(session.status).toBe("waiting");
    expect(session.pendingHooks[0]?.token).toBe(token);
    expect(session.consumedHookTokens.has(token)).toBe(false);

    await session.resumeHook({ token, value: { report: "complete" } });

    expect(session.status).toBe("completed");
    expect(session.state.report).toBe("complete");
  });

  test("composes static delegation with approval and signal waits", async () => {
    const indexed = defineSignal({
      correlation: z.object({ report: z.string() }),
      id: "content.indexed",
      payload: z.object({ url: z.string().url() }),
      title: "Content indexed",
    });
    const delegate = step.delegate({
      id: "content.delegate-static",
      input: { request: z.string() },
      instructions: "Draft the requested article.",
      output: { report: z.string() },
    });
    const approve = step.approval({
      decision: z.enum(["approve", "reject"]),
      id: "content.approve",
      input: { report: z.string() },
      mapDecision: ({ decision }) => ({ approved: decision === "approve" }),
      output: { approved: z.boolean() },
      reject: ({ decision }) => decision === "reject" ? "Publishing rejected." : undefined,
      request: ({ input }) => ({ report: input.report }),
      title: "Approve draft",
    });
    const waitForIndex = step.waitFor({
      correlation: ({ input }) => ({ report: input.report }),
      id: "content.wait-for-index",
      input: { report: z.string() },
      signal: indexed,
    });
    const session = await loop({
      id: "delegation-approval-signal",
      steps: [
        delegate.create({ stepId: "delegate" }),
        approve.create({ stepId: "approve" }),
        waitForIndex.create({ stepId: "wait-for-index" }),
      ],
    }).start({ request: "Durable delegation" }, { runId: "run-composed-delegation" });

    const delegateHook = session.pendingHooks[0]!;
    expect(delegateHook).toMatchObject({
      input: {
        attempt: 1,
        capabilities: [],
        instructions: "Draft the requested article.",
        outputSchema: { required: ["report"], type: "object" },
        runId: "run-composed-delegation",
        stepId: "delegate",
        workflowId: "delegation-approval-signal",
      },
      kind: "handoff_requested",
    });
    const staticHandoff = delegateHook.input as Record<string, unknown>;
    expect("artifacts" in staticHandoff).toBe(false);
    expect("context" in staticHandoff).toBe(false);
    expect("summary" in staticHandoff).toBe(false);
    expect("title" in staticHandoff).toBe(false);

    await session.resumeHook({ token: delegateHook.token, value: { report: "Final draft" } });
    const approvalHook = session.pendingHooks[0]!;
    expect(approvalHook).toMatchObject({ kind: "approval", title: "Approve draft" });

    await session.resumeHook({ token: approvalHook.token, value: "approve" });
    const signalHook = session.pendingHooks[0]!;
    expect(signalHook).toMatchObject({
      input: { correlation: { report: "Final draft" }, signalId: "content.indexed" },
      kind: "signal",
    });

    await session.resumeHook({
      token: signalHook.token,
      value: {
        occurrenceId: "occ-indexed",
        occurredAt: "2026-07-21T20:00:00.000Z",
        payload: { url: "https://example.com/final-draft" },
      },
    });

    expect(session.status).toBe("completed");
    expect(session.state).toMatchObject({
      approved: true,
      payload: { url: "https://example.com/final-draft" },
      report: "Final draft",
    });
  });

  test("preserves delegated child-workflow identity and resumes the child hook", async () => {
    const delegate = step.delegate({
      id: "child.delegate",
      input: { request: z.string() },
      instructions: ({ input }) => input.request,
      output: { report: z.string() },
    });
    const child = workflow({
      catalog: [delegate],
      document: {
        edges: [
          { id: "trigger-to-delegate", source: "trigger", target: "delegate" },
          { id: "delegate-to-end", source: "delegate", target: "end" },
        ],
        end: { id: "end", output: { report: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "delegated-child",
        nodes: [{ catalogItemId: delegate.id, id: "delegate" }],
        trigger: { id: "trigger", input: { request: { jsonSchema: { type: "string" } } }, type: "manual" },
        version: 1,
      },
      input: { request: z.string() },
      output: { report: z.string() },
    });
    const nested = step.workflow({ id: "parent.child", workflow: child });
    const session = await loop({
      id: "delegated-parent",
      steps: [nested.create({ stepId: "child" })],
    }).start({ request: "Investigate" }, { runId: "run-parent" });
    const hook = session.pendingHooks[0]!;
    const handoff = hook.input as { runId: string; stepId: string; workflowId: string };

    expect(session.status).toBe("waiting");
    expect(hook.kind).toBe("handoff_requested");
    expect(hook.token).toStartWith("hook:run-parent:child:child:");
    expect(handoff).toMatchObject({
      stepId: "delegate",
      workflowId: "delegated-child",
    });
    expect(handoff.runId).not.toBe(session.runId);

    await session.resumeHook({ token: hook.token, value: { report: "child result" } });

    expect(session.status).toBe("completed");
    expect(session.state.report).toBe("child result");
  });

  test("creates a fresh delegated handoff for each workflow loop iteration", async () => {
    const revise = step.delegate({
      id: "draft.revise",
      input: { prompt: z.string() },
      instructions: ({ input }) => `Revise ${input.prompt}`,
      output: { report: z.string() },
    });
    const gate = step({
      id: "draft.gate",
      input: { report: z.string() },
      output: {},
      run({ input }) {
        return input.report === "revise" ? goto("revise") : {};
      },
    });
    const session = await loop({
      id: "delegation-loop",
      steps: [
        revise.create({ stepId: "revise" }),
        gate.create({ stepId: "gate" }),
      ],
    }).start({ prompt: "the draft" }, { runId: "run-delegation-loop" });
    const firstToken = session.pendingHooks[0]!.token;

    await session.resumeHook({ token: firstToken, value: { report: "revise" } });
    const secondToken = session.pendingHooks[0]!.token;

    expect(session.status).toBe("waiting");
    expect(secondToken).not.toBe(firstToken);
    expect(secondToken).toContain(":2:");

    await session.resumeHook({ token: secondToken, value: { report: "final" } });

    expect(session.status).toBe("completed");
    expect(session.state.report).toBe("final");
    expect(session.events.filter((event) =>
      event.type === "step.completed" && event.stepId === "revise"
    )).toHaveLength(2);
  });

  test("runs step.model as exactly one schema-constrained model operation", async () => {
    const calls: string[] = [];
    const worker: ModelWorkerPort = {
      async complete(input) {
        calls.push(input.operation);
        input.onEvent?.({ message: "request", type: "model.request.started" });
        input.onEvent?.({ message: "response", type: "model.response.completed" });
        return JSON.stringify({ answer: "dromio-ok" });
      },
      async completeJson() {
        throw new Error("step.model must not run a hidden evaluator");
      },
    };
    const generate = step.model({
      id: "example.generate",
      input: { prompt: z.string() },
      model: worker,
      output: { answer: z.string() },
      prompt: { kind: "text", text: "Answer the request." },
    });
    const events: string[] = [];
    const workflow = loop({
      id: "model-test",
      steps: [generate.create({ stepId: "generate" })],
    });

    const session = await workflow.start({ prompt: "Reply dromio-ok" }, {
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(session.state.answer).toBe("dromio-ok");
    expect(generate.kind).toBe("model");
    expect(calls).toEqual(["example.generate"]);
    expect(events).toContain("model.request.started");
    expect(events).not.toContain("evaluation.completed");
  });

  test("prefers a placement model over the definition default", async () => {
    const calls: string[] = [];
    const worker = (name: string): ModelWorkerPort => ({
      async complete() {
        calls.push(name);
        return JSON.stringify({ answer: name });
      },
      async completeJson() {
        throw new Error("not used");
      },
    });
    const generated = step.model({
      id: "example.model-precedence",
      input: { prompt: z.string() },
      model: worker("default"),
      output: { answer: z.string() },
      prompt: { kind: "text", text: "Answer." },
    });
    const session = await loop({
      id: "model-precedence",
      steps: [generated.create({ model: worker("placement") })],
    }).start({ prompt: "hello" });

    expect(session.state.answer).toBe("placement");
    expect(calls).toEqual(["placement"]);
  });

  test("runs step.gate as a visible deterministic decision", async () => {
    const policy = defineScorePolicy({
      gaps: [],
      gates: [
        { id: "gate.pass", minScore: 0.8, nextAction: "complete", status: "pass" },
        { id: "gate.revise", minScore: 0, nextAction: "revise", status: "revise" },
      ],
      id: "score.example.response",
      risks: [],
      satisfies: [],
    });
    const gate = step.gate({
      id: "example.gate-response",
      input: { evaluation: promptedOperationEvaluationSchema },
      policy,
    });
    const events: string[] = [];
    const workflow = loop({ id: "gate-test", steps: [gate.create()] });

    const session = await workflow.start({
      evaluation: {
        nextAction: "complete",
        score: 0.91,
        scorePolicyId: policy.id,
        status: "pass",
      },
    }, {
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(session.state.decision).toMatchObject({
      score: 0.91,
      status: "completed",
    });
    expect(gate.kind).toBe("gate");
    expect(events).toContain("score.gate.completed");
    expect(events).toContain("evaluation.completed");
    expect(events).toContain("operation.decision.completed");
  });

  test("places an independently runnable workflow as one step without factories", async () => {
    const uppercase = step({
      id: "example.uppercase",
      input: { message: z.string() },
      output: { result: z.string() },
      run: ({ input }) => ({ result: input.message.toUpperCase() }),
    });
    const child = workflow({
      catalog: [uppercase],
      document: {
        edges: [
          { id: "trigger-to-uppercase", source: "trigger", target: "uppercase" },
          { id: "uppercase-to-end", source: "uppercase", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "uppercase-workflow",
        label: "Uppercase workflow",
        nodes: [{ catalogItemId: uppercase.id, id: "uppercase" }],
        trigger: { id: "trigger", input: { message: { jsonSchema: { type: "string" } } }, type: "manual" },
        version: 1,
      },
      input: { message: z.string() },
      output: { result: z.string() },
    });
    const nested = step.workflow({ id: "example.nested-uppercase", workflow: child });
    const parent = loop({ id: "parent", steps: [nested.create({ stepId: "nested" })] });
    const childEvents: string[] = [];

    const childSession = await child.start({ message: "child" });
    const parentSession = await parent.start({ message: "parent" }, {
      onEvent(event) {
        if (event.type === "step.completed") childEvents.push(event.stepId ?? "");
      },
    });

    expect(childSession.state.result).toBe("CHILD");
    expect(parentSession.state.result).toBe("PARENT");
    expect(nested.execution?.childWorkflowDocumentId).toBe("uppercase-workflow");
    expect(nested.kind).toBe("workflow");
    expect(childEvents).toContain("nested.uppercase");
  });

  test("propagates parent workflow use into an authored child workflow", async () => {
    const readUse = step({
      id: "example.read-parent-use",
      input: { message: z.string() },
      output: { result: z.string() },
      run({ input, use }) {
        return { result: `${(use as { prefix: string }).prefix}:${input.message}` };
      },
    });
    const child = workflow({
      catalog: [readUse],
      document: {
        edges: [
          { id: "trigger-to-read", source: "trigger", target: "read" },
          { id: "read-to-end", source: "read", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "parent-use-child",
        nodes: [{ catalogItemId: readUse.id, id: "read" }],
        trigger: { id: "trigger", input: { message: { jsonSchema: { type: "string" } } }, type: "manual" },
        version: 1,
      },
      input: { message: z.string() },
      output: { result: z.string() },
      use: { prefix: "stale" },
    });
    const nested = step.workflow({ id: "example.parent-use-child", workflow: child });
    const parent = loop({ id: "parent-use-parent", steps: [nested.create()], use: { prefix: "parent" } });

    const session = await parent.start({ message: "value" });

    expect(session.state.result).toBe("parent:value");
  });

  test("propagates child workflow questions and resumes the same child run", async () => {
    let preparations = 0;
    const prepare = step({
      id: "example.prepare-question",
      input: { message: z.string() },
      output: { prepared: z.string() },
      run({ input }) {
        preparations += 1;
        return { prepared: input.message };
      },
    });
    const answer = step({
      id: "example.answer-question",
      input: { prepared: z.string() },
      output: { result: z.string() },
      run({ answers, input }) {
        if (!("audience" in answers)) {
          return ask({
            id: "audience",
            prompt: "Who is the audience?",
            title: "Audience",
            type: "text",
          });
        }
        return { result: `${input.prepared}:${answers.audience}` };
      },
    });
    const child = workflow({
      catalog: [prepare, answer],
      document: {
        edges: [
          { id: "trigger-to-prepare", source: "trigger", target: "prepare" },
          { id: "prepare-to-answer", source: "prepare", target: "answer" },
          { id: "answer-to-end", source: "answer", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "question-child",
        nodes: [
          { catalogItemId: prepare.id, id: "prepare" },
          { catalogItemId: answer.id, id: "answer" },
        ],
        trigger: { id: "trigger", input: { message: { jsonSchema: { type: "string" } } }, type: "manual" },
        version: 1,
      },
      input: { message: z.string() },
      output: { result: z.string() },
    });
    const nested = step.workflow({ id: "example.question-child", workflow: child });
    const parent = loop({ id: "question-parent", steps: [nested.create({ stepId: "clarify" })] });

    const session = await parent.start({ message: "hello" });
    const childRunId = (session.events.find((event) =>
      event.type === "question.requested" && event.stepId === "clarify.answer"
    )?.detail as { childRunId?: string } | undefined)?.childRunId;

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions.map((question) => question.id)).toEqual(["clarify.audience"]);
    await session.answer({ questionId: "clarify.audience", value: "developers" });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("hello:developers");
    expect(preparations).toBe(1);
    expect(session.events.filter((event) =>
      (event.detail as { childRunId?: string } | undefined)?.childRunId === childRunId
    ).length).toBeGreaterThan(1);
  });

  test("selects exactly one typed child workflow with router lifecycle events", async () => {
    const executions: string[] = [];
    const makeChild = (id: string) => {
      const process = step({
        id: `example.${id}`,
        input: { kind: z.string(), value: z.string() },
        output: { result: z.string() },
        run({ input }) {
          executions.push(id);
          return { result: `${id}:${input.value}` };
        },
      });
      return workflow({
        catalog: [process],
        document: {
          edges: [
            { id: "trigger-to-process", source: "trigger", target: "process" },
            { id: "process-to-end", source: "process", target: "end" },
          ],
          end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
          id: `${id}-workflow`,
          label: `${id} workflow`,
          nodes: [{ catalogItemId: process.id, id: "process" }],
          trigger: {
            id: "trigger",
            input: {
              kind: { jsonSchema: { type: "string" } },
              value: { jsonSchema: { type: "string" } },
            },
            type: "manual",
          },
          version: 1,
        },
        input: { kind: z.string(), value: z.string() },
        output: { result: z.string() },
      });
    };
    const alpha = makeChild("alpha");
    const beta = makeChild("beta");
    const router = step.router({
      id: "example.router",
      routes: { alpha, beta },
      select: ({ input }) => input.kind === "alpha" ? "alpha" : "beta",
    });
    const parent = loop({ id: "router-parent", steps: [router.create()] });
    const events: string[] = [];

    const session = await parent.start({ kind: "beta", value: "hello" }, {
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(session.state.result).toBe("beta:hello");
    expect(executions).toEqual(["beta"]);
    expect(events).toContain("router.started");
    expect(events).toContain("router.selected");
    expect(events).toContain("router.completed");
    expect(router.execution).toMatchObject({
      kind: "router",
      routes: [
        { childWorkflowDocumentId: "alpha-workflow", id: "alpha" },
        { childWorkflowDocumentId: "beta-workflow", id: "beta" },
      ],
    });

    const failedEvents: string[] = [];
    const invalidRouter = step.router({
      id: "example.invalid-selection",
      routes: { alpha, beta },
      select: () => "missing" as "alpha",
    });
    await expect(loop({ id: "invalid-router-parent", steps: [invalidRouter.create()] }).start({
      kind: "alpha",
      value: "hello",
    }, {
      onEvent(event) {
        failedEvents.push(event.type);
      },
    })).rejects.toBeInstanceOf(UnknownWorkflowRouteError);
    expect(failedEvents).toContain("router.started");
    expect(failedEvents).toContain("router.failed");
    expect(failedEvents).not.toContain("router.selected");
  });

  test("maps parent input and propagates parent runtime dependencies to the selected child", async () => {
    const makeChild = (id: string) => {
      const process = step({
        id: `example.mapped-${id}`,
        input: { value: z.string() },
        output: { result: z.string() },
        run(context) {
          const use = context.use as { prefix: string };
          return { result: `${use.prefix}:${id}:${context.input.value}` };
        },
      });
      return workflow({
        catalog: [process],
        document: {
          edges: [
            { id: "trigger-to-process", source: "trigger", target: "process" },
            { id: "process-to-end", source: "process", target: "end" },
          ],
          end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
          id: `mapped-${id}-workflow`,
          nodes: [{ catalogItemId: process.id, id: "process" }],
          trigger: { id: "trigger", input: { value: { jsonSchema: { type: "string" } } }, type: "manual" },
          version: 1,
        },
        input: { value: z.string() },
        output: { result: z.string() },
        use: { prefix: "stale" },
      });
    };
    const router = step.router({
      id: "example.mapped-router",
      input: { route: z.enum(["alpha", "beta"]), source: z.string() },
      mapInput: ({ input }) => ({ value: input.source }),
      routes: { alpha: makeChild("alpha"), beta: makeChild("beta") },
      select: ({ input }) => input.route,
    });
    const parent = loop({
      id: "mapped-router-parent",
      steps: [router.create()],
      use: { prefix: "parent" },
    });

    const session = await parent.start({ route: "beta", source: "mapped" });

    expect(session.state.result).toBe("parent:beta:mapped");
  });

  test("hydrates and resumes the selected waiting child without in-memory router state", async () => {
    const makeChild = (id: string) => {
      const askValue = step.ask({
        answer: z.string().trim().min(1),
        id: `example.waiting-${id}`,
        input: { value: z.string() },
        mapAnswer: ({ answer, input }) => ({ result: `${id}:${input.value}:${answer}` }),
        output: { result: z.string() },
        question: () => ({ id: `${id}-answer`, prompt: `Answer ${id}`, type: "text" }),
      });
      return workflow({
        catalog: [askValue],
        document: {
          edges: [
            { id: "trigger-to-ask", source: "trigger", target: "ask" },
            { id: "ask-to-end", source: "ask", target: "end" },
          ],
          end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
          id: `waiting-${id}-workflow`,
          nodes: [{ catalogItemId: askValue.id, id: "ask" }],
          trigger: { id: "trigger", input: { value: { jsonSchema: { type: "string" } } }, type: "manual" },
          version: 1,
        },
        input: { value: z.string() },
        output: { result: z.string() },
      });
    };
    const makeParent = () => {
      const router = step.router({
        id: "example.durable-router",
        input: { route: z.enum(["alpha", "beta"]), value: z.string() },
        mapInput: ({ input }) => ({ value: input.value }),
        routes: { alpha: makeChild("alpha"), beta: makeChild("beta") },
        select: ({ input }) => input.route,
      });
      return workflow({
        catalog: [router],
        document: {
          edges: [
            { id: "trigger-to-router", source: "trigger", target: "router" },
            { id: "router-to-end", source: "router", target: "end" },
          ],
          end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
          id: "durable-router-parent",
          nodes: [{ catalogItemId: router.id, id: "router", kind: "router" }],
          trigger: {
            id: "trigger",
            input: {
              route: { jsonSchema: { enum: ["alpha", "beta"], type: "string" } },
              value: { jsonSchema: { type: "string" } },
            },
            type: "manual",
          },
          version: 1,
        },
        input: { route: z.enum(["alpha", "beta"]), value: z.string() },
        output: { result: z.string() },
      });
    };
    const first = await makeParent().start({ route: "beta", value: "persisted" });
    expect(first.status).toBe("waiting");

    const hydrated = makeParent().hydrate(first.snapshot());
    await hydrated.answer({ questionId: "beta-answer", value: "resumed" });
    await hydrated.resume();

    expect(hydrated.status).toBe("completed");
    expect(hydrated.state.result).toBe("beta:persisted:resumed");
    expect(hydrated.events.filter((event) => event.type === "router.selected")).toHaveLength(2);
  });

  test("rejects router children with incompatible contracts", () => {
    const child = (id: string, output: z.ZodType) => {
      const process = step({
        id: `example.${id}`,
        input: { value: z.string() },
        output: { result: output },
        run: () => ({ result: id }),
      });
      return workflow({
        catalog: [process],
        document: {
          edges: [
            { id: "trigger-to-process", source: "trigger", target: "process" },
            { id: "process-to-end", source: "process", target: "end" },
          ],
          end: { id: "end", output: { result: { jsonSchema: {} } }, type: "result" },
          id: `${id}-workflow`,
          nodes: [{ catalogItemId: process.id, id: "process" }],
          trigger: { id: "trigger", input: { value: { jsonSchema: { type: "string" } } }, type: "manual" },
          version: 1,
        },
        input: { value: z.string() },
        output: { result: output },
      });
    };

    expect(() => step.router({
      id: "example.invalid-router",
      routes: { number: child("number", z.number()), text: child("text", z.string()) },
      select: () => "text",
    })).toThrow("incompatible output contract");
  });

  test("builds step.evaluate as a visible and independently runnable workflow", async () => {
    const worker: ModelWorkerPort = {
      async complete() {
        return JSON.stringify({
          evaluation: {
            message: "Grounded and concise.",
            nextAction: "complete",
            score: 0.93,
            status: "pass",
          },
        });
      },
      async completeJson() {
        throw new Error("evaluation uses the ordinary single-operation model step");
      },
    };
    const policy = defineScorePolicy({
      gaps: [],
      gates: [
        { id: "gate.pass", minScore: 0.8, nextAction: "complete", status: "pass" },
        { id: "gate.revise", minScore: 0, nextAction: "revise", status: "revise" },
      ],
      id: "score.example.answer",
      risks: [],
      satisfies: [],
    });
    const evaluate = step.evaluate({
      evaluator: {
        model: worker,
        output: { evaluation: promptedOperationEvaluationSchema },
        prompt: { kind: "text", text: "Evaluate the answer." },
      },
      id: "example.evaluate-answer",
      input: { answer: z.string() },
      label: "Evaluate answer",
      policy,
    });
    const nestedEvents: string[] = [];
    const parent = loop({ id: "evaluation-parent", steps: [evaluate.create()] });

    const independent = await evaluate.workflow.start({ answer: "dromio-ok" });
    const nested = await parent.start({ answer: "dromio-ok" }, {
      onEvent(event) {
        if (event.type === "step.completed") nestedEvents.push(event.stepId ?? "");
      },
    });
    const ejected = evaluate.eject();

    expect(independent.state.decision).toMatchObject({ status: "completed" });
    expect(nested.state.evaluation).toMatchObject({ score: 0.93 });
    expect(evaluate.kind).toBe("evaluation");
    expect(evaluate.workflow.graph().nodes.map((node) => node.id)).toEqual(["assess", "gate"]);
    expect(nestedEvents).toContain("example.evaluate-answer.assess");
    expect(nestedEvents).toContain("example.evaluate-answer.gate");
    expect(ejected.document.nodes.map((node) => node.id)).toEqual(["assess", "gate"]);
    expect(ejected.document.nodes.map((node) => node.kind)).toEqual(["model", "gate"]);
  });

  test("ejects evaluation documents and explicit source atomically", async () => {
    const policy = defineScorePolicy({
      gaps: [],
      gates: [{ id: "gate.pass", minScore: 0, nextAction: "complete", status: "pass" }],
      id: "score.example.eject",
      risks: [],
      satisfies: [],
    });
    const evaluate = step.evaluate({
      evaluator: {
        output: { evaluation: promptedOperationEvaluationSchema },
        prompt: { kind: "text", text: "Evaluate." },
      },
      id: "example.eject-answer",
      input: { answer: z.string() },
      policy,
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "dromio-eject-"));
    const sourcePath = path.join(directory, "step.ts");
    const documentDirectory = path.join(directory, ".dromio", "workflows");
    await writeFile(sourcePath, `import { step, workflow } from "@dromio/workflow";
export const evaluateAnswer = step.evaluate({
  evaluator: { output: evaluationOutput, prompt: evaluationPrompt },
  id: "example.eject-answer",
  input: answerInput,
  policy,
});
`);
    try {
      const result = evaluate.eject({
        directory: documentDirectory,
        source: sourcePath,
      });
      const source = await readFile(sourcePath, "utf8");
      const document = JSON.parse(await readFile(result.documentPath, "utf8"));

      expect(document.id).toBe("example.eject-answer.evaluation");
      expect(source).toContain("export const evaluateAnswerAssessor = step.model({");
      expect(source).toContain("export const evaluateAnswerGate = step.gate({");
      expect(source).toContain("export const evaluateAnswerWorkflow = workflow({");
      expect(source).toContain("export const evaluateAnswer = step.workflow({");
      expect(source).not.toContain("step.evaluate(");

      const failedSource = path.join(directory, "missing.ts");
      await writeFile(failedSource, "export const answer = 1;\n");
      expect(() => evaluate.eject({
        directory: path.join(directory, "failed"),
        source: failedSource,
      })).toThrow("expected exactly one step.evaluate declaration");
      expect(await readFile(failedSource, "utf8")).toBe("export const answer = 1;\n");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("starts step.fork workflow branches concurrently and joins their outputs", async () => {
    const started: string[] = [];
    const pending: Array<() => void> = [];
    const makeBranch = (branchId: string, outputKey: "assessment" | "analysis") => {
      const branchStep = step({
        id: `example.${branchId}`,
        input: { value: z.string() },
        output: outputKey === "assessment"
          ? { assessment: z.string() }
          : { analysis: z.string() },
        async run({ input }) {
          started.push(branchId);
          await new Promise<void>((resolve) => {
            pending.push(resolve);
            if (pending.length === 2) queueMicrotask(() => pending.splice(0).forEach((release) => release()));
          });
          return outputKey === "assessment"
            ? { assessment: `${branchId}:${input.value}` }
            : { analysis: `${branchId}:${input.value}` };
        },
      });
      return workflow({
        catalog: [branchStep],
        document: {
          edges: [
            { id: "trigger-to-branch", source: "trigger", target: "branch" },
            { id: "branch-to-end", source: "branch", target: "end" },
          ],
          end: {
            id: "end",
            output: { [outputKey]: { jsonSchema: { type: "string" } } },
            type: "result",
          },
          id: `${branchId}-workflow`,
          nodes: [{ catalogItemId: branchStep.id, id: "branch" }],
          trigger: {
            id: "trigger",
            input: { value: { jsonSchema: { type: "string" } } },
            type: "manual",
          },
          version: 1,
        },
        input: { value: z.string() },
        output: outputKey === "assessment"
          ? { assessment: z.string() }
          : { analysis: z.string() },
      });
    };
    const fork = step.fork({
      branches: {
        analysis: makeBranch("analysis", "analysis"),
        assessment: makeBranch("assessment", "assessment"),
      },
      id: "example.parallel-review",
      label: "Parallel review",
    });
    const events: string[] = [];
    const parent = loop({ id: "fork-parent", steps: [fork.create()] });

    const session = await parent.start({ value: "response" }, {
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(started.sort()).toEqual(["analysis", "assessment"]);
    expect(session.state).toMatchObject({
      analysis: "analysis:response",
      assessment: "assessment:response",
    });
    expect(events).toContain("fork.started");
    expect(events.filter((type) => type === "fork.branch.started")).toHaveLength(2);
    expect(events).toContain("join.completed");
    expect(fork.execution?.branches).toHaveLength(2);
    expect(fork.kind).toBe("fork");
  });

  test("maps step.forEach items through one child workflow contract", async () => {
    const uppercase = step({
      id: "example.uppercase-item",
      input: { message: z.string() },
      output: { result: z.string() },
      run: ({ input }) => ({ result: input.message.toUpperCase() }),
    });
    const child = workflow({
      catalog: [uppercase],
      document: {
        edges: [
          { id: "trigger-to-uppercase", source: "trigger", target: "uppercase" },
          { id: "uppercase-to-end", source: "uppercase", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "uppercase-item-workflow",
        nodes: [{ catalogItemId: uppercase.id, id: "uppercase" }],
        trigger: {
          id: "trigger",
          input: { message: { jsonSchema: { type: "string" } } },
          type: "manual",
        },
        version: 1,
      },
      input: { message: z.string() },
      output: { result: z.string() },
    });
    const each = step.forEach({
      collect: "results",
      id: "example.uppercase-all",
      items: "messages",
      workflow: child,
    });
    const parent = loop({ id: "for-each-parent", steps: [each.create()] });

    const session = await parent.start({ messages: ["one", "two", "three"] });

    expect(session.state.results).toEqual(["ONE", "TWO", "THREE"]);
    expect(each.execution).toMatchObject({
      childWorkflowDocumentId: "uppercase-item-workflow",
      itemSource: "messages",
      kind: "forEach",
    });
    expect(each.kind).toBe("composite");
  });

  test("builds a serializable app and runs its workflows through the CLI", async () => {
    const write = step({
      id: "example.cli-write",
      input: { prompt: z.string() },
      output: { result: z.string() },
      run({ artifacts, input }) {
        artifacts.file({ mediaType: "text/plain", path: "/tmp/message.txt" });
        return { result: input.prompt };
      },
    });
    const authoredWorkflow = workflow({
      catalog: [write],
      document: {
        edges: [
          { id: "trigger-to-write", source: "trigger", target: "write" },
          { id: "write-to-end", source: "write", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "cli-workflow",
        label: "CLI workflow",
        nodes: [{ catalogItemId: write.id, id: "write" }],
        trigger: {
          id: "trigger",
          input: { prompt: { jsonSchema: { type: "string" } } },
          type: "manual",
        },
        version: 1,
      },
      input: { prompt: z.string() },
      output: { result: z.string() },
    });
    const inspectWorkflow = workflow({
      catalog: [write],
      document: {
        edges: [
          { id: "trigger-to-write", source: "trigger", target: "write" },
          { id: "write-to-end", source: "write", target: "end" },
        ],
        end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "inspect-workflow",
        label: "Inspect workflow",
        nodes: [{ catalogItemId: write.id, id: "write" }],
        trigger: {
          id: "trigger",
          input: { prompt: { jsonSchema: { type: "string" } } },
          type: "manual",
        },
        version: 1,
      },
      input: { prompt: z.string() },
      output: { result: z.string() },
    });
    const authoredApp = workflowApp({
      defaultWorkflow: authoredWorkflow,
      id: "cli-app",
      title: "CLI App",
      workflows: [authoredWorkflow, inspectWorkflow],
    });
    let output = "";

    const result = await runWorkflowCli(authoredApp, {
      argv: ["--", "hello"],
      exit: false,
      stdout: { write(chunk) { output += chunk; } },
    });

    expect(result.exitCode).toBe(0);
    expect(result.run?.artifacts).toEqual([{
      kind: "file",
      mediaType: "text/plain",
      name: "message.txt",
      path: "/tmp/message.txt",
    }]);
    expect(authoredApp.definition).toMatchObject({
      defaultWorkflowId: "cli-workflow",
      id: "cli-app",
      type: "workflow-app",
    });
    expect(output).toContain("CLI App");
    expect(output).toContain("message.txt");

    const selected = await runWorkflowCli(authoredApp, {
      argv: ["--workflow", "inspect-workflow", "inspect this"],
      exit: false,
      stdout: { write() {} },
    });
    expect(selected.run?.workflowId).toBe("inspect-workflow");

    const positional = await runWorkflowCli(authoredApp, {
      argv: ["inspect-workflow", "inspect this positionally"],
      exit: false,
      stdout: { write() {} },
    });
    expect(positional.run?.workflowId).toBe("inspect-workflow");

    let workflowList = "";
    const listed = await runWorkflowCli(authoredApp, {
      argv: ["--list-workflows"],
      exit: false,
      stdout: { write(chunk) { workflowList += chunk; } },
    });
    expect(listed.exitCode).toBe(0);
    expect(workflowList).toContain("cli-workflow (default)");
    expect(workflowList).toContain("inspect-workflow");

    let verboseOutput = "";
    const verbose = await runWorkflowCli(authoredApp, {
      argv: ["--verbose", "--workflow", "inspect-workflow", "inspect verbosely"],
      exit: false,
      stdout: { write(chunk) { verboseOutput += chunk; } },
    });
    expect(verbose.exitCode).toBe(0);
    expect(verboseOutput).toContain("inspect-workflow");

    let errorOutput = "";
    const unknown = await runWorkflowCli(authoredApp, {
      argv: ["--workflow", "missing", "inspect this"],
      exit: false,
      stderr: { write(chunk) { errorOutput += chunk; } },
    });
    expect(unknown.exitCode).toBe(2);
    expect(errorOutput).toContain("Unknown workflow: missing");
    expect(errorOutput).toContain("Available workflows: cli-workflow, inspect-workflow");

    errorOutput = "";
    const missingId = await runWorkflowCli(authoredApp, {
      argv: ["--workflow"],
      exit: false,
      stderr: { write(chunk) { errorOutput += chunk; } },
    });
    expect(missingId.exitCode).toBe(2);
    expect(errorOutput).toContain("Missing workflow id after --workflow.");

    errorOutput = "";
    const missingPrompt = await runWorkflowCli(authoredApp, {
      argv: ["--workflow", "inspect-workflow"],
      exit: false,
      stderr: { write(chunk) { errorOutput += chunk; } },
    });
    expect(missingPrompt.exitCode).toBe(2);
    expect(errorOutput).toContain("A prompt is required.");
  });
});
