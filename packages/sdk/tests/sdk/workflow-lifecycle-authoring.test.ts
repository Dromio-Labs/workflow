import { describe, expect, test } from "bun:test";
import { step, workflow } from "../../src/sdk/index.js";
import {
  defineEvaluationBar,
  loop,
  retry,
  type EventRecord,
} from "@dromio/workflow/core";
import { z } from "zod";

describe("workflow lifecycle authoring", () => {
  test("validates and resumes a typed approval after hydration", async () => {
    const approval = step.approval({
      decision: z.object({ approved: z.boolean(), note: z.string().optional() }),
      id: "notes.approve",
      input: { draft: z.string() },
      mapDecision: ({ decision, input }) => ({
        approvedDraft: `${input.draft}:${decision.note ?? "approved"}`,
      }),
      output: { approvedDraft: z.string() },
      reject: ({ decision }) => decision.approved ? undefined : "Draft rejected.",
      request: ({ input }) => ({ draft: input.draft }),
      title: "Approve draft",
    });
    const runtime = loop({ id: "approval-test", steps: [approval.create()] });
    const waiting = await runtime.start({ draft: "hello" });

    expect(approval.kind).toBe("approval");
    expect(waiting.pendingHooks[0]).toMatchObject({
      id: "notes.approve",
      input: { draft: "hello" },
      kind: "approval",
      render: { kind: "approval" },
      title: "Approve draft",
    });
    expect(waiting.pendingHooks[0]?.schema).toMatchObject({ type: "object" });

    const hydrated = runtime.hydrate(waiting.snapshot());
    await hydrated.resumeHook({
      token: hydrated.pendingHooks[0]!.token,
      value: { approved: true, note: "ship" },
    });

    expect(hydrated.status).toBe("completed");
    expect(hydrated.state.approvedDraft).toBe("hello:ship");

    const rejected = await runtime.start({ draft: "no" });
    await rejected.resumeHook({
      token: rejected.pendingHooks[0]!.token,
      value: { approved: false, note: "revise" },
    });
    expect(rejected.status).toBe("failed");
    expect(rejected.events.find((event) => event.type === "step.failed")?.message)
      .toBe("Draft rejected.");
  });

  test("authors duration and absolute-time waits with stable timer identity", async () => {
    const durationWait = step.sleep({
      id: "notes.wait-duration",
      input: { noteId: z.string() },
      mapFired: ({ fired, input }) => ({ firedAt: fired.firedAt, noteId: input.noteId }),
      output: { firedAt: z.string(), noteId: z.string() },
      schedule: () => ({ ms: 5_000 }),
      timerId: ({ input }) => `notes.duration.${input.noteId}`,
    });
    const durationRuntime = loop({ id: "duration-wait", steps: [durationWait.create()] });
    const duration = await durationRuntime.start({ noteId: "note-1" });

    expect(durationWait.kind).toBe("wait");
    expect(duration.pendingHooks[0]).toMatchObject({
      id: "notes.duration.note-1",
      kind: "timer",
    });
    expect(typeof duration.pendingHooks[0]?.expiresAt).toBe("string");

    const restored = durationRuntime.hydrate(duration.snapshot());
    await restored.resumeHook({
      token: restored.pendingHooks[0]!.token,
      value: { firedAt: "2026-07-15T15:00:00.000Z" },
    });
    expect(restored.state).toMatchObject({
      firedAt: "2026-07-15T15:00:00.000Z",
      noteId: "note-1",
    });

    const absoluteWait = step.sleep({
      id: "notes.wait-until",
      input: { noteId: z.string(), wakeAt: z.string() },
      mapFired: ({ fired }) => ({ firedAt: fired.firedAt }),
      output: { firedAt: z.string() },
      schedule: ({ input }) => ({ until: input.wakeAt }),
      timerId: ({ input }) => `notes.absolute.${input.noteId}`,
    });
    const absolute = await loop({ id: "absolute-wait", steps: [absoluteWait.create()] })
      .start({ noteId: "note-2", wakeAt: "2026-07-16T09:30:00.000Z" });
    expect(absolute.pendingHooks[0]).toMatchObject({
      expiresAt: "2026-07-16T09:30:00.000Z",
      id: "notes.absolute.note-2",
      kind: "timer",
    });

    await absolute.cancel({ reason: "No longer needed." });
    expect(absolute.status).toBe("cancelled");
    expect(absolute.pendingHooks).toEqual([]);
    expect(absolute.events.some((event) => event.type === "hook.cancelled")).toBe(true);
  });

  test("emits canonical operation spans for progress, success, and failure", async () => {
    const events: EventRecord[] = [];
    const persist = step({
      id: "notes.persist",
      input: { value: z.string() },
      output: { saved: z.string() },
      async run(context) {
        const saved = await context.operation({ id: "storage.write" }, async (operation) => {
          operation.progress({ message: "Writing note." });
          return context.input.value;
        });
        return { saved };
      },
    });
    const completed = await loop({ id: "operation-success", steps: [persist.create()] })
      .start({ value: "saved" }, { onEvent: (event) => { events.push(event); } });

    expect(completed.state.saved).toBe("saved");
    expect(events.filter((event) => event.type.startsWith("operation.")).map((event) => event.type))
      .toEqual(["operation.started", "operation.progress", "operation.completed"]);
    expect(events.find((event) => event.type === "operation.completed")?.trace).toMatchObject({
      parentSpanId: "step:notes.persist:attempt:1",
      spanId: "operation:notes.persist:storage.write:attempt:1",
      status: "ok",
    });

    const failedEvents: EventRecord[] = [];
    const failing = step({
      id: "notes.fail-write",
      output: {},
      async run(context) {
        await context.operation({ id: "storage.write" }, () => {
          throw new Error("disk unavailable");
        });
        return {};
      },
    });
    await expect(loop({ id: "operation-failure", steps: [failing.create()] })
      .start({}, { onEvent: (event) => { failedEvents.push(event); } }))
      .rejects.toThrow("disk unavailable");
    expect(failedEvents.find((event) => event.type === "operation.failed")).toMatchObject({
      message: "Failed storage.write: disk unavailable",
      trace: { status: "error" },
    });

    const retryEvents: EventRecord[] = [];
    const retrying = step({
      id: "notes.retry-write",
      maxRetries: 1,
      output: { saved: z.boolean() },
      async run(context) {
        try {
          await context.operation({ id: "storage.write" }, () => {
            if (context.step.attempt === 1) throw new Error("transient conflict");
          });
        } catch (error) {
          if (context.step.attempt === 1 && error instanceof Error) return retry(error.message);
          throw error;
        }
        return { saved: true };
      },
    });
    const retried = await loop({ id: "operation-retry", steps: [retrying.create()] })
      .start({}, { onEvent: (event) => { retryEvents.push(event); } });
    expect(retried.state.saved).toBe(true);
    expect(retryEvents.filter((event) => event.type === "operation.failed")[0]?.detail)
      .toMatchObject({ attempt: 1 });
    expect(retryEvents.filter((event) => event.type === "operation.completed")[0]?.detail)
      .toMatchObject({ attempt: 2 });
  });

  test("runs promptedContract as recursively inspectable executable phases", async () => {
    const contractSchema = z.object({
      kind: z.literal("brief"),
      requirements: z.array(z.object({
        id: z.string(),
        label: z.string(),
        required: z.boolean().optional(),
        status: z.enum(["satisfied", "missing", "ambiguous", "unsupported"]),
        value: z.string().nullable(),
      })),
    });
    const contractStep = step.promptedContract({
      contract: contractSchema,
      definition: {
        createQuestions: ({ contract }) => contract.requirements[0]?.status === "satisfied"
          ? []
          : [{
              id: "audience",
              prompt: "Who is this for?",
              title: "Audience",
              type: "text",
            }],
        evaluateContract: ({ contract }) => {
          const passed = contract.requirements[0]?.status === "satisfied";
          return defineEvaluationBar({
            gaps: passed ? [] : [{ id: "audience", message: "Audience missing.", severity: "high" }],
            label: "Brief clarity",
            nextAction: passed ? "complete" : "ask",
            questions: [],
            risks: [],
            satisfies: [{ id: "audience", passed, reason: passed ? "Known." : "Missing." }],
            score: passed ? 1 : 0.4,
            status: passed ? "pass" : "needs_input",
            subjectId: "brief",
            threshold: 0.8,
          });
        },
        id: "brief.contract-loop",
        questionPolicy: { id: "brief.questions", maxAnswerAttempts: 2 },
        resolveContract: ({ answers }) => {
          const audience = typeof answers.audience === "string" ? answers.audience : null;
          const contract: z.infer<typeof contractSchema> = {
            kind: "brief",
            requirements: [{
              id: "audience",
              label: "Audience",
              required: true,
              status: audience ? "satisfied" : "missing",
              value: audience,
            }],
          };
          return contract;
        },
        revisionPolicy: { id: "brief.revisions", maxContractLoops: 2 },
      },
      id: "brief.resolve",
      input: { prompt: z.string() },
      mapCompleted: ({ contract }) => ({
        audience: contract.requirements[0]?.value ?? "",
      }),
      output: { audience: z.string().min(1) },
    });
    const runtime = loop({ id: "brief-workflow", steps: [contractStep.create()] });
    const waiting = await runtime.start({ prompt: "Write an update." });

    expect(waiting.status).toBe("waiting");
    expect(waiting.pendingQuestions[0]).toMatchObject({ id: "brief.resolve.audience" });
    await waiting.answer({
      questionId: waiting.pendingQuestions[0]!.id,
      value: "developers",
    });
    await waiting.resume();
    expect(waiting.status).toBe("completed");
    expect(waiting.state.audience).toBe("developers");

    const inspection = contractStep.inspect();
    expect(contractStep.implementation).toMatchObject({
      factory: "step.promptedContract",
      kind: "composite",
      workflowDocumentId: "brief.resolve.prompted-contract-loop",
    });
    expect(inspection.catalog.map((phase) => phase.id)).toEqual([
      "brief.resolve.resolve",
      "brief.resolve.assess",
      "brief.resolve.gate",
      "brief.resolve.ask",
      "brief.resolve.merge",
      "brief.resolve.revise",
      "brief.resolve.complete",
    ]);
    expect(inspection.document.loops?.[0]).toMatchObject({
      backTo: "resolve",
      end: "revise",
      start: "resolve",
    });
    const authoredWorkflow = workflow({
      catalog: [contractStep],
      document: {
        edges: [
          { id: "trigger-contract", source: "trigger", target: "contract" },
          { id: "contract-end", source: "contract", target: "end" },
        ],
        end: {
          id: "end",
          label: "Done",
          output: { audience: { jsonSchema: { type: "string" } } },
          type: "result",
        },
        id: "inspectable-contract",
        nodes: [{
          catalogItemId: contractStep.id,
          id: "contract",
          label: "Resolve brief",
        }],
        trigger: {
          id: "trigger",
          input: { prompt: { jsonSchema: { type: "string" } } },
          label: "Start",
          type: "manual",
        },
        version: 1,
      },
    });
    expect(authoredWorkflow.graph().nodes[0]?.childNodes?.map((node) => node.id)).toEqual([
      "resolve",
      "assess",
      "gate",
      "ask",
      "merge",
      "revise",
      "complete",
    ]);
    expect(authoredWorkflow.graph().nodes[0]?.childNodes?.find((node) => node.id === "resolve")?.loop)
      .toMatchObject({ id: "revision-loop" });
    expect(authoredWorkflow.graph().nodes[0]?.childNodes?.map((node) => node.catalog?.kind)).toEqual([
      "step",
      "evaluation",
      "gate",
      "question",
      "step",
      "step",
      "step",
    ]);
    expect(waiting.events.filter((event) => event.type === "step.started").map((event) =>
      (event.detail as { itemWorkflowStepId?: string } | undefined)?.itemWorkflowStepId
    ))
      .toEqual(expect.arrayContaining([
        "resolve",
        "assess",
        "gate",
        "ask",
        "merge",
        "revise",
        "complete",
      ]));

    let persisted = false;
    const blocked = step.promptedContract({
      contract: contractSchema,
      definition: {
        createQuestions: () => [],
        evaluateContract: () => defineEvaluationBar({
          gaps: [{ id: "blocked", message: "Blocked.", severity: "high" }],
          label: "Blocked contract",
          nextAction: "cancel",
          questions: [],
          risks: [],
          satisfies: [{ id: "blocked", passed: false, reason: "Blocked." }],
          score: 0,
          status: "fail",
          subjectId: "blocked",
          threshold: 1,
        }),
        id: "blocked.loop",
        resolveContract: () => {
          const contract: z.infer<typeof contractSchema> = {
            kind: "brief",
            requirements: [{
              id: "audience",
              label: "Audience",
              required: true,
              status: "missing",
              value: null,
            }],
          };
          return contract;
        },
      },
      id: "blocked.contract",
      input: { prompt: z.string() },
      mapCompleted: () => ({ audience: "never" }),
      output: { audience: z.string() },
    });
    const persist = step({
      id: "blocked.persist",
      input: { audience: z.string() },
      output: {},
      run() {
        persisted = true;
        return {};
      },
    });
    const blockedRun = await loop({
      id: "blocked-workflow",
      steps: [blocked.create(), persist.create()],
    }).start({ prompt: "Do not persist." });
    expect(blockedRun.status).toBe("failed");
    expect(persisted).toBe(false);
  });
});
