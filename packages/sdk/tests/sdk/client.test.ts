import { describe, expect, test } from "bun:test";
import { createClient } from "@dromio/workflow/client";
import { createHttpAdapter } from "@dromio/workflow/client";
import {
  createHook,
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import { createIntentRuntime } from "@dromio/workflow/core";

describe("intent client", () => {
  test("uses the same shape for in-process runtime and HTTP transports", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        gated: loop({
          id: "gated",
          steps: [
            createRuntimeStep("ask", (context) => {
              if (typeof context.answers.scope === "string") {
                return done({ scope: context.answers.scope });
              }
              return {
                questions: [{
                  id: "scope",
                  options: [{ label: "Minimal", value: "minimal" }],
                  prompt: "Scope?",
                  type: "choice" as const,
                }],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const local = createClient({ runtime });
    const http = createHttpAdapter({ basePath: "/api/runtime", runtime });
    const remote = createClient({
      baseUrl: "http://local/api/runtime",
      fetch: (request) => http.fetch(request as Request),
    });

    for (const client of [local, remote]) {
      const run = await client.runs.create({
        input: {},
        runId: client === local ? "run_local" : "run_remote",
        workflow: "gated",
      });
      expect(run.session.status).toBe("waiting");
      expect((await client.workflows.list())[0]?.key).toBe("gated");
      expect((await client.sessions.get(run.session.runId)).pendingQuestions[0]).toMatchObject({ id: "scope" });

      const completed = await client.hooks.resume({
        token: run.session.pendingHooks[0]!.token,
        value: "minimal",
      });
      expect(completed.status).toBe("completed");
      expect(completed.state.ask).toEqual({ scope: "minimal" });

      const events = await client.sessions.events(completed.runId);
      expect(events.some((event) => event.type === "question.answered")).toBe(true);
      expect(await collect(client.sessions.streamEvents(completed.runId))).toHaveLength(events.length);
    }
  });

  test("exposes action, checkpoint, and rerun helpers", async () => {
    const gate = createHook<{}, string>({ id: "gate" });
    const runtime = createIntentRuntime({
      workflows: {
        actioned: loop({
          id: "actioned",
          steps: [
            createRuntimeStep("wait", async (context) => done({
              answer: await context.waitFor(gate, {}),
            })),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_actions", workflow: "actioned" });

    expect((await client.sessions.actions(run.session.runId)).map((action) => action.key)).toContain("cancel");
    expect(await client.sessions.checkpoints(run.session.runId)).toHaveLength(1);

    const cancelled = await client.sessions.applyAction({
      actionKey: "cancel",
      input: { reason: "done" },
      sessionId: run.session.runId,
    });
    expect(cancelled.status).toBe("accepted");
    expect(cancelled.session?.status).toBe("cancelled");
  });
});

async function collect<T>(items: AsyncIterable<T>) {
  const output: T[] = [];
  for await (const item of items) output.push(item);
  return output;
}
