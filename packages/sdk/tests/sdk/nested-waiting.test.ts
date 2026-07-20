import { describe, expect, test } from "bun:test";
import { ask, done, hook, loop, createRuntimeStep } from "@dromio/workflow/core";
import {
  forEachWorkflowStep,
  workflowStep,
} from "../../src/sdk/product/step/workflow-step.js";
import {
  createWorkflowForkBranch,
  forkWorkflowStep,
} from "../../src/sdk/product/step/workflow-fork-step.js";
import { z } from "zod";

const textSchema = z.string().min(1);

function questionChild(id: string, questionId = "approval") {
  return loop<unknown, Record<string, never>>({
    id,
    steps: [createRuntimeStep<unknown, Record<string, never>>("question", ({ answers }) => {
      if (!(questionId in answers)) {
        return ask({
          id: questionId,
          prompt: "Continue?",
          title: "Approval",
          type: "text",
        });
      }
      return done({ result: `approved:${answers[questionId]}` });
    })],
  });
}

function hookChild(id: string) {
  return loop<unknown, Record<string, never>>({
    id,
    steps: [createRuntimeStep<unknown, Record<string, never>>("gate", async (context) => {
      const decision = await context.waitFor(
        hook<{ prompt: string }, string>({ id: "sign-off", kind: "approval", title: "Sign off" }),
        { prompt: "Ship it?" },
      );
      return done({ result: `signed:${decision}` });
    })],
  });
}

describe("nested child-workflow waiting", () => {
  test("propagates a child approval hook through the parent and routes the decision back", async () => {
    const parent = loop({
      id: "testing.hook-parent",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: hookChild("testing.hook-child"),
          id: "run-child",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.hook-child", id: "testing.hook-child" },
        }),
      ],
    });

    const session = await parent.start({ source: "value" });

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions).toHaveLength(0);
    expect(session.pendingHooks).toHaveLength(1);
    const [pending] = session.pendingHooks;
    expect(pending!.id).toBe("run-child.sign-off");
    expect(pending!.kind).toBe("approval");
    expect(pending!.stepId).toBe("run-child");

    await session.resumeHook({ token: pending!.token, value: "go" });

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("signed:go");
  });

  test("propagates a grandchild question through two levels and answers it from the top", async () => {
    const middle = loop({
      id: "testing.middle",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: questionChild("testing.leaf"),
          id: "run-leaf",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.leaf", id: "testing.leaf" },
        }),
      ],
    });
    const root = loop({
      id: "testing.root",
      steps: [
        workflowStep({
          childInput: ({ input }) => ({ source: input.source }),
          createWorkflow: middle,
          id: "run-middle",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.middle", id: "testing.middle" },
        }),
      ],
    });

    const session = await root.start({ source: "value" });

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions.map((question) => question.id))
      .toEqual(["run-middle.run-leaf.approval"]);

    await session.answer({ questionId: "run-middle.run-leaf.approval", value: "depth-two" });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("approved:depth-two");
  });

  test("propagates a grandchild approval hook as a mirrored hook of a mirrored hook", async () => {
    const middle = loop({
      id: "testing.hook-middle",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: hookChild("testing.hook-leaf"),
          id: "run-leaf",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.hook-leaf", id: "testing.hook-leaf" },
        }),
      ],
    });
    const root = loop({
      id: "testing.hook-root",
      steps: [
        workflowStep({
          childInput: ({ input }) => ({ source: input.source }),
          createWorkflow: middle,
          id: "run-middle",
          input: { source: textSchema },
          mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
          output: { result: textSchema },
          workflow: { documentId: "testing.hook-middle", id: "testing.hook-middle" },
        }),
      ],
    });

    const session = await root.start({ source: "value" });

    expect(session.status).toBe("waiting");
    expect(session.pendingHooks).toHaveLength(1);
    const [pending] = session.pendingHooks;
    expect(pending!.id).toBe("run-middle.run-leaf.sign-off");
    expect(pending!.kind).toBe("approval");

    await session.resumeHook({ token: pending!.token, value: "double-go" });

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("signed:double-go");
  });

  test("surfaces waiting fork branches together with distinguishable pending work", async () => {
    const branchStep = forkWorkflowStep({
      branches: () => [
        createWorkflowForkBranch({
          childInput: {},
          createWorkflow: () => questionChild("testing.fork-a"),
          id: "alpha",
          mapResult: (session) => String(session.state.result),
          workflow: { documentId: "testing.fork-a", id: "testing.fork-a" },
        }),
        createWorkflowForkBranch({
          childInput: {},
          createWorkflow: () => questionChild("testing.fork-b"),
          id: "beta",
          mapResult: (session) => String(session.state.result),
          workflow: { documentId: "testing.fork-b", id: "testing.fork-b" },
        }),
      ],
      id: "fan-out",
      input: { source: textSchema },
      join: (results) => ({ result: `${results.alpha}|${results.beta}` }),
      output: { result: textSchema },
    });
    const parent = loop({ id: "testing.fork-parent", steps: [branchStep] });

    const session = await parent.start({ source: "value" });

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions.map((question) => question.id).sort()).toEqual([
      "fan-out.alpha.approval",
      "fan-out.beta.approval",
    ]);

    await session.answer({ questionId: "fan-out.alpha.approval", value: "one" });
    await session.answer({ questionId: "fan-out.beta.approval", value: "two" });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("approved:one|approved:two");
  });

  test("parks a for-each loop at the waiting item and finishes in order after the answer", async () => {
    const started: string[] = [];
    const eachStep = forEachWorkflowStep({
      childInput: (item: string) => ({ item }),
      collect: (results) => ({
        result: results
          .map((iteration) => iteration.status === "completed"
            ? String(iteration.session?.state.result)
            : "failed")
          .join("|"),
      }),
      createWorkflow: (item) => loop<unknown, { item: string }>({
        id: "testing.each-child",
        steps: [createRuntimeStep<unknown, { item: string }>("work", ({ answers, input }) => {
          if (input.item === "b" && !("go" in answers)) {
            return ask({ id: "go", prompt: "Continue b?", title: "Go", type: "text" });
          }
          return done({ result: `done:${input.item}` });
        })],
      }),
      id: "each",
      input: { source: textSchema },
      itemId: (item) => item,
      items: () => ["a", "b", "c"],
      onItemStarted: ({ itemId }) => {
        started.push(itemId);
      },
      output: { result: textSchema },
      workflow: { documentId: "testing.each-child", id: "testing.each-child" },
    });
    const parent = loop({ id: "testing.each-parent", steps: [eachStep] });

    const session = await parent.start({ source: "value" });

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions.map((question) => question.id)).toEqual(["each.b.go"]);
    expect(started).toEqual(["a", "b"]);

    await session.answer({ questionId: "each.b.go", value: "yes" });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.result).toBe("done:a|done:b|done:c");
    expect(started).toEqual(["a", "b", "b", "c"]);
  });

  test("rehydrates a parent with a waiting grandchild from its snapshot and completes it", async () => {
    let preparations = 0;
    const makeRoot = () => {
      const middle = loop({
        id: "testing.durable-middle",
        steps: [
          createRuntimeStep<unknown, { source: string }>("prepare", () => {
            preparations += 1;
            return done({ prepared: "ready" });
          }),
          workflowStep({
            childInput: () => ({}),
            createWorkflow: questionChild("testing.durable-leaf"),
            id: "run-leaf",
            input: { source: textSchema },
            mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
            output: { result: textSchema },
            workflow: { documentId: "testing.durable-leaf", id: "testing.durable-leaf" },
          }),
        ],
      });
      return loop({
        id: "testing.durable-root",
        steps: [
          workflowStep({
            childInput: ({ input }) => ({ source: input.source }),
            createWorkflow: middle,
            id: "run-middle",
            input: { source: textSchema },
            mapOutput: (session) => ({ result: textSchema.parse(session.state.result) }),
            output: { result: textSchema },
            workflow: { documentId: "testing.durable-middle", id: "testing.durable-middle" },
          }),
        ],
      });
    };

    const first = await makeRoot().start({ source: "value" });
    expect(first.status).toBe("waiting");
    expect(first.pendingQuestions.map((question) => question.id))
      .toEqual(["run-middle.run-leaf.approval"]);
    expect(preparations).toBe(1);
    const snapshot = first.snapshot();

    const revived = await makeRoot().hydrate(JSON.parse(JSON.stringify(snapshot)));
    expect(revived.status).toBe("waiting");

    await revived.answer({ questionId: "run-middle.run-leaf.approval", value: "durable" });
    await revived.resume();

    expect(revived.status).toBe("completed");
    expect(revived.state.result).toBe("approved:durable");
    expect(preparations).toBe(1);
  });

  test("still propagates a failure from a resumed child", async () => {
    const child = loop<unknown, Record<string, never>>({
      id: "testing.resume-failure-child",
      steps: [createRuntimeStep<unknown, Record<string, never>>("question", ({ answers }) => {
        if (!("go" in answers)) {
          return ask({ id: "go", prompt: "Continue?", title: "Go", type: "text" });
        }
        throw new Error("child exploded after resume");
      })],
    });
    const parent = loop({
      id: "testing.resume-failure-parent",
      steps: [
        workflowStep({
          childInput: () => ({}),
          createWorkflow: child,
          id: "run-child",
          input: { source: textSchema },
          mapOutput: () => ({ result: "unreachable" }),
          output: { result: textSchema },
          workflow: {
            documentId: "testing.resume-failure-child",
            id: "testing.resume-failure-child",
          },
        }),
      ],
    });

    const session = await parent.start({ source: "value" });
    expect(session.status).toBe("waiting");

    await session.answer({ questionId: "run-child.go", value: "yes" });
    await expect(session.resume()).rejects.toThrow("child exploded after resume");
  });
});
