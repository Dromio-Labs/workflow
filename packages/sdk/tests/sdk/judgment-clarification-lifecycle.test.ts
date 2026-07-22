import { describe, expect, test } from "bun:test";
import { step, workflow } from "../../src/sdk/index.js";
import {
  defineScorePolicy,
  promptedOperationEvaluationSchema,
} from "@dromio/workflow/core";
import { z } from "zod";

const passRevisePolicy = defineScorePolicy({
  gaps: [],
  gates: [
    { id: "pass", minScore: 0.8, nextAction: "complete", status: "pass" },
    { id: "revise", minScore: 0, nextAction: "revise", status: "revise" },
  ],
  id: "score.lifecycle",
  risks: [],
  satisfies: [],
});

describe("judgment and clarification durable lifecycle", () => {
  test("hydrates a waiting delegated judgment without replaying production or revision", async () => {
    let produced = 0;
    let revised = 0;
    const build = () => {
      const assessor = step.delegate({
        id: "durable-quality.assess",
        input: { candidate: z.string() },
        instructions: "Judge the candidate and return one canonical evaluation.",
        output: { evaluation: promptedOperationEvaluationSchema },
      });
      const judge = workflow.judge({
        assessor,
        id: "durable-quality.judge",
        input: { candidate: z.string() },
        policy: passRevisePolicy,
      });
      const produce = step({
        id: "durable-quality.produce",
        input: { request: z.string() },
        output: { candidate: z.string() },
        run({ input }) {
          produced += 1;
          return { candidate: `draft:${input.request}` };
        },
      });
      const revise = step({
        id: "durable-quality.revise",
        input: { candidate: z.string(), evaluation: promptedOperationEvaluationSchema },
        output: { candidate: z.string() },
        run({ input }) {
          revised += 1;
          return { candidate: `${input.candidate}:revised` };
        },
      });
      return workflow.judgeUntil({
        id: "durable-quality",
        input: { request: z.string() },
        judge,
        maxAttempts: 3,
        produce,
        revise,
      });
    };

    const waiting = await build().start({ request: "todo" });
    expect(waiting.status).toBe("waiting");
    expect(produced).toBe(1);
    const firstToken = waiting.pendingHooks[0]!.token;

    const firstRestart = build().hydrate(waiting.snapshot());
    await firstRestart.resumeHook({
      token: firstRestart.pendingHooks[0]!.token,
      value: {
        evaluation: {
          message: "Add persistence.",
          nextAction: "revise",
          score: 0.4,
          status: "revise",
        },
      },
    });
    expect(firstRestart.status).toBe("waiting");
    expect(firstRestart.pendingHooks[0]!.token).not.toBe(firstToken);
    expect({ produced, revised }).toEqual({ produced: 1, revised: 1 });

    const secondRestart = build().hydrate(firstRestart.snapshot());
    await secondRestart.resumeHook({
      token: secondRestart.pendingHooks[0]!.token,
      value: {
        evaluation: {
          message: "Ready.",
          nextAction: "complete",
          score: 0.92,
          status: "pass",
        },
      },
    });

    expect(secondRestart.status).toBe("completed");
    expect(secondRestart.state).toMatchObject({
      attempts: 2,
      candidate: "draft:todo:revised",
      decision: { status: "completed" },
    });
    expect({ produced, revised }).toEqual({ produced: 1, revised: 1 });
  });

  test("runs the declared judgment exhaustion handler exactly once", async () => {
    let escalations = 0;
    const assessor = step({
      id: "exhausted-quality.assess",
      input: { candidate: z.string() },
      output: { evaluation: promptedOperationEvaluationSchema },
      run: () => ({
        evaluation: {
          message: "Still incomplete.",
          nextAction: "revise" as const,
          score: 0.2,
          status: "revise" as const,
        },
      }),
    });
    const judge = workflow.judge({
      assessor,
      id: "exhausted-quality.judge",
      input: { candidate: z.string() },
      policy: passRevisePolicy,
    });
    const produce = step({
      id: "exhausted-quality.produce",
      input: { request: z.string() },
      output: { candidate: z.string() },
      run: ({ input }) => ({ candidate: input.request }),
    });
    const revise = step({
      id: "exhausted-quality.revise",
      input: { candidate: z.string(), evaluation: promptedOperationEvaluationSchema },
      output: { candidate: z.string() },
      run: ({ input }) => ({ candidate: `${input.candidate}:retry` }),
    });
    const exhausted = step({
      id: "exhausted-quality.human-review",
      input: {},
      output: {},
      run() {
        escalations += 1;
        return {};
      },
    });
    const quality = workflow.judgeUntil({
      exhausted,
      id: "exhausted-quality",
      input: { request: z.string() },
      judge,
      maxAttempts: 2,
      produce,
      revise,
    });

    const session = await quality.start({ request: "draft" });

    expect(session.status).toBe("completed");
    expect(session.state.attempts).toBe(2);
    expect(escalations).toBe(1);
  });

  test("clarifies prototype, MVP, and production contracts with durable answer provenance", async () => {
    const scenarios = [
      { stage: "prototype", required: ["platform"] },
      { stage: "mvp", required: ["platform", "users", "persistence", "authentication", "deployment"] },
      {
        stage: "production",
        required: [
          "platform",
          "users",
          "persistence",
          "authentication",
          "deployment",
          "security",
          "observability",
          "backups",
          "accessibility",
          "scaling",
          "serviceObjectives",
          "recovery",
        ],
      },
    ] as const;

    for (const scenario of scenarios) {
      const build = () => todoClarification(20);
      let session = await build().start({ request: "create a todo app" });
      expect(session.status).toBe("waiting");
      expect(session.pendingQuestions[0]).toMatchObject({ id: "stage", type: "choice" });

      if (scenario.stage === "mvp") {
        await session.answer({ questionId: "stage", value: "" });
        expect(session.pendingQuestions[0]?.id).toBe("stage");
      }
      await session.answer({ questionId: "stage", value: scenario.stage });
      await session.resume();

      if (scenario.stage === "mvp") {
        session = build().hydrate(session.snapshot());
        expect(session.state.acceptedAnswers).toEqual(expect.arrayContaining([
          expect.objectContaining({ requirementId: "stage", source: "human", value: "mvp" }),
        ]));
      }

      while (session.status === "waiting") {
        const pending = session.pendingQuestions[0]!;
        await session.answer({ questionId: pending.id, value: `answer:${pending.id}` });
        await session.resume();
      }

      expect(session.status).toBe("completed");
      expect(session.state.contract).toMatchObject({
        nonGoals: ["native mobile app"],
        stage: scenario.stage,
      });
      for (const requirement of scenario.required) {
        expect((session.state.contract as Record<string, unknown>)[requirement])
          .toBe(`answer:${requirement}`);
      }
      expect(session.state.acceptedAnswers).toHaveLength(scenario.required.length + 1);
    }
  });

  test("revises a low-scoring contract directly when no human blockers remain", async () => {
    const contract = z.object({ polished: z.boolean(), value: z.string() });
    const blockers = z.array(z.object({ id: z.string(), message: z.string() }));
    let questions = 0;
    let revisions = 0;
    const assessor = step({
      id: "polish.assess",
      input: { contract },
      output: { evaluation: promptedOperationEvaluationSchema },
      run: ({ input }) => ({
        evaluation: input.contract.polished
          ? { nextAction: "complete" as const, score: 1, status: "pass" as const }
          : { nextAction: "revise" as const, score: 0.5, status: "revise" as const },
      }),
    });
    const judge = workflow.judge({
      assessor,
      id: "polish.judge",
      input: { contract },
      policy: passRevisePolicy,
    });
    const clarify = workflow.clarifyUntil({
      answer: z.string().min(1),
      blockers,
      contract,
      id: "polish",
      input: { request: z.string() },
      judge,
      maxRounds: 3,
      merge: ({ contract: current }) => ({ blockers: [], contract: current }),
      question() {
        questions += 1;
        return { id: "unexpected", prompt: "Unexpected", title: "Unexpected", type: "text" };
      },
      resolve: step({
        id: "polish.resolve",
        input: { request: z.string() },
        output: { blockers, contract },
        run: () => ({ blockers: [], contract: { polished: false, value: "ready" } }),
      }),
      revise: step({
        id: "polish.revise",
        input: { blockers, contract },
        output: { blockers, contract },
        run: ({ input }) => {
          revisions += 1;
          return { blockers: [], contract: { ...input.contract, polished: true } };
        },
      }),
    });

    const session = await clarify.start({ request: "polish" });

    expect(session.status).toBe("completed");
    expect(session.state.contract).toEqual({ polished: true, value: "ready" });
    expect({ questions, revisions }).toEqual({ questions: 0, revisions: 1 });
  });

  test("fails a revision that contradicts an accepted human fact", async () => {
    const contract = z.object({ polished: z.boolean(), stage: z.string().optional() });
    const blockers = z.array(z.object({ id: z.string(), message: z.string() }));
    const assessor = step({
      id: "protected-facts.assess",
      input: { contract },
      output: { evaluation: promptedOperationEvaluationSchema },
      run: ({ input }) => ({
        evaluation: input.contract.polished
          ? { nextAction: "complete" as const, score: 1, status: "pass" as const }
          : { nextAction: "revise" as const, score: 0.5, status: "revise" as const },
      }),
    });
    const judge = workflow.judge({
      assessor,
      id: "protected-facts.judge",
      input: { contract },
      policy: passRevisePolicy,
    });
    const clarify = workflow.clarifyUntil({
      answer: z.string().min(1),
      blockers,
      contract,
      id: "protected-facts",
      input: { request: z.string() },
      judge,
      maxRounds: 3,
      merge: ({ answer, contract: current }) => ({
        blockers: [],
        contract: { ...current, stage: answer },
      }),
      question: () => ({
        id: "stage",
        prompt: "How far should the app go?",
        requirementId: "stage",
        title: "Stage",
        type: "text",
      }),
      resolve: step({
        id: "protected-facts.resolve",
        input: { request: z.string() },
        output: { blockers, contract },
        run: () => ({
          blockers: [{ id: "stage", message: "Stage is required." }],
          contract: { polished: false },
        }),
      }),
      revise: step({
        id: "protected-facts.revise",
        input: { blockers, contract },
        output: { blockers, contract },
        run: ({ input }) => ({
          blockers: [],
          contract: { ...input.contract, polished: true, stage: "production" },
        }),
      }),
    });

    const session = await clarify.start({ request: "create a todo app" });
    await session.answer({ questionId: "stage", value: "mvp" });
    await session.resume();

    expect(session.status).toBe("failed");
    expect(session.state.acceptedAnswers).toEqual([
      expect.objectContaining({ requirementId: "stage", value: "mvp" }),
    ]);
    expect(session.events.find((event) => event.type === "step.failed")?.message)
      .toContain("contradicts accepted human answer for stage");
  });

  test("distinguishes clarification round exhaustion from user cancellation", async () => {
    const exhausted = await todoClarification(1).start({ request: "create a todo app" });
    await exhausted.answer({ questionId: "stage", value: "mvp" });
    await exhausted.resume();
    expect(exhausted.status).toBe("failed");
    expect(exhausted.events.find((event) => event.type === "step.failed")?.message)
      .toContain("after 1 rounds");

    const cancelled = await todoClarification(5).start({ request: "create a todo app" });
    await cancelled.cancel({ reason: "User stopped clarification." });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.pendingQuestions).toEqual([]);
  });

  test("keeps clarification answer validation when the bundle is placed as a child", async () => {
    const child = todoClarification(5);
    const placed = step.workflow({ id: "parent.clarify", workflow: child });
    const parent = workflow({
      catalog: [placed],
      document: {
        edges: [
          { id: "trigger-child", source: "trigger", target: "child" },
          { id: "child-end", source: "child", target: "end" },
        ],
        end: {
          id: "end",
          output: { contract: { jsonSchema: z.toJSONSchema(todoContractSchema) } },
          type: "result",
        },
        id: "clarification-parent",
        nodes: [{ catalogItemId: placed.id, id: "child", kind: "workflow" }],
        trigger: {
          id: "trigger",
          input: { request: { jsonSchema: { type: "string" } } },
          type: "manual",
        },
        version: 1,
      },
      input: { request: z.string() },
      output: { contract: todoContractSchema },
    });
    const session = await parent.start({ request: "create a todo app" });
    const token = session.pendingHooks[0]!.token;
    const stageQuestionId = session.pendingQuestions[0]!.id;
    expect(session.pendingHooks[0]!.schema).toMatchObject({ minLength: 1, type: "string" });

    await session.answer({ questionId: stageQuestionId, value: "" });

    expect(session.status).toBe("waiting");
    expect(session.pendingHooks[0]!.token).toBe(token);
    expect(session.answers).not.toHaveProperty(stageQuestionId);
    await session.answer({ questionId: stageQuestionId, value: "prototype" });
    await session.resume();
    while (session.status === "waiting") {
      const pending = session.pendingQuestions[0]!;
      await session.answer({ questionId: pending.id, value: `answer:${pending.id}` });
      await session.resume();
    }
    expect(session.status).toBe("completed");
    expect(session.state.contract).toMatchObject({ stage: "prototype" });
  });
});

const todoContractSchema = z.object({
  accessibility: z.string().optional(),
  authentication: z.string().optional(),
  backups: z.string().optional(),
  deployment: z.string().optional(),
  nonGoals: z.array(z.string()),
  observability: z.string().optional(),
  persistence: z.string().optional(),
  platform: z.string().optional(),
  recovery: z.string().optional(),
  scaling: z.string().optional(),
  security: z.string().optional(),
  serviceObjectives: z.string().optional(),
  stage: z.enum(["prototype", "mvp", "production"]).optional(),
  users: z.string().optional(),
});

type TodoContract = z.infer<typeof todoContractSchema>;

const todoBlockersSchema = z.array(z.object({ id: z.string(), message: z.string() }));

function todoBlockers(contract: TodoContract) {
  const shared = ["platform"];
  const mvp = ["users", "persistence", "authentication", "deployment"];
  const production = [
    "security",
    "observability",
    "backups",
    "accessibility",
    "scaling",
    "serviceObjectives",
    "recovery",
  ];
  const required = contract.stage === "prototype"
    ? shared
    : contract.stage === "mvp"
      ? [...shared, ...mvp]
      : contract.stage === "production"
        ? [...shared, ...mvp, ...production]
        : [];
  return [
    ...(!contract.stage ? [{ id: "stage", message: "Choose prototype, MVP, or production." }] : []),
    ...required.filter((id) => !contract[id as keyof TodoContract]).map((id) => ({
      id,
      message: `Decide ${id}.`,
    })),
  ];
}

function todoClarification(maxRounds: number) {
  const assessor = step({
    id: "todo-lifecycle.assess",
    input: { contract: todoContractSchema },
    output: { evaluation: promptedOperationEvaluationSchema },
    run: ({ input }) => {
      const complete = todoBlockers(input.contract).length === 0;
      return {
        evaluation: complete
          ? { nextAction: "complete" as const, score: 1, status: "pass" as const }
          : { nextAction: "ask" as const, score: 0.4, status: "needs_input" as const },
      };
    },
  });
  const judge = workflow.judge({
    assessor,
    id: "todo-lifecycle.judge",
    input: { contract: todoContractSchema },
    policy: passRevisePolicy,
  });
  return workflow.clarifyUntil({
    answer: z.string().trim().min(1),
    blockers: todoBlockersSchema,
    contract: todoContractSchema,
    id: "todo-lifecycle",
    input: { request: z.string() },
    judge,
    maxRounds,
    merge({ answer, contract, question }) {
      const next = { ...contract, [question.requirementId!]: answer } as TodoContract;
      return { blockers: todoBlockers(next), contract: next };
    },
    question({ blockers }) {
      const blocker = blockers[0]!;
      return blocker.id === "stage"
        ? {
          id: blocker.id,
          options: ["prototype", "mvp", "production"].map((value) => ({ label: value, value })),
          prompt: "How far should this todo app go?",
          requirementId: blocker.id,
          title: "Delivery stage",
          type: "choice",
        }
        : {
          id: blocker.id,
          prompt: `Why ${blocker.message}`,
          requirementId: blocker.id,
          title: blocker.message,
          type: "text",
        };
    },
    resolve: step({
      id: "todo-lifecycle.resolve",
      input: { request: z.string() },
      output: { blockers: todoBlockersSchema, contract: todoContractSchema },
      run: () => {
        const contract: TodoContract = { nonGoals: ["native mobile app"] };
        return { blockers: todoBlockers(contract), contract };
      },
    }),
    revise: step({
      id: "todo-lifecycle.revise",
      input: { blockers: todoBlockersSchema, contract: todoContractSchema },
      output: { blockers: todoBlockersSchema, contract: todoContractSchema },
      run: ({ input }) => ({
        blockers: todoBlockers(input.contract),
        contract: input.contract,
      }),
    }),
  });
}
