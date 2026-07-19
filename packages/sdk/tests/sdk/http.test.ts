import { describe, expect, test } from "bun:test";
import { createHttpAdapter, createHttpRoutes } from "@dromio/workflow/client";
import {
  createHook,
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import { createIntentRuntime } from "@dromio/workflow/core";

describe("intent http adapter", () => {
  test("starts workflows and exposes session state through fetch routes", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        "demo.workflow": loop({
          id: "demo.workflow",
          steps: [
            createRuntimeStep("finish", () => done({ ok: true })),
          ],
        }),
      },
    });
    const http = createHttpAdapter({ runtime });

    const workflows = await json(http.fetch(new Request("http://local/api/workflows")));
    expect(workflows.workflows[0].key).toBe("demo.workflow");

    const started = await json(http.fetch(new Request("http://local/api/workflows/demo.workflow/runs", {
      body: JSON.stringify({ input: { prompt: "hello" }, runId: "run_http" }),
      method: "POST",
    })));
    expect(started.session.runId).toBe("run_http");
    expect(started.session.status).toBe("completed");

    const session = await json(http.fetch(new Request("http://local/api/sessions/run_http")));
    expect(session.session.state.finish).toEqual({ ok: true });

    const events = await json(http.fetch(new Request("http://local/api/sessions/run_http/events")));
    expect(events.events.some((event: { type: string }) => event.type === "run.completed")).toBe(true);
  });

  test("resumes hooks and serves SSE streams", async () => {
    const approval = createHook<{ label: string }, string>({ id: "approval" });
    const runtime = createIntentRuntime({
      workflows: {
        gated: loop({
          id: "gated",
          steps: [
            createRuntimeStep("gate", async (context) => {
              const answer = await context.waitFor(approval, { label: "Approve" });
              return done({ answer });
            }),
          ],
        }),
      },
    });
    const http = createHttpAdapter({ runtime });

    const started = await json(http.fetch(new Request("http://local/api/workflows/gated/runs", {
      body: JSON.stringify({ input: {}, runId: "run_gate" }),
      method: "POST",
    })));
    const token = started.session.pendingHooks[0].token;

    const resumed = await json(http.fetch(new Request(`http://local/api/hooks/${encodeURIComponent(token)}/resume`, {
      body: JSON.stringify({ value: "yes" }),
      method: "POST",
    })));
    expect(resumed.session.status).toBe("completed");

    const stream = await http.fetch(new Request("http://local/api/sessions/run_gate/events/stream"));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain("event: run.completed");
  });

  test("exposes lower-level route handlers and action routes", async () => {
    const gate = createHook<{}, string>({ id: "gate" });
    const runtime = createIntentRuntime({
      workflows: {
        "demo.workflow": loop({
          id: "demo.workflow",
          steps: [
            createRuntimeStep("finish", async (context) => {
              const answer = await context.waitFor(gate, {});
              return done({ answer });
            }),
          ],
        }),
      },
    });
    const routes = createHttpRoutes({ runtime });
    const started = await json(routes.runWorkflow(
      new Request("http://local/custom", {
        body: JSON.stringify({ input: {}, runId: "route_run" }),
        method: "POST",
      }),
      { workflowKey: "demo.workflow" },
    ));

    const actions = await json(routes.listActions(
      new Request("http://local/custom"),
      { sessionId: started.session.runId },
    ));
    expect(actions.actions.map((action: { key: string }) => action.key)).toContain("cancel");

    const cancelled = await json(routes.applyAction(
      new Request("http://local/custom", {
        body: JSON.stringify({ input: { reason: "route test" } }),
        method: "POST",
      }),
      { actionKey: "cancel", sessionId: started.session.runId },
    ));
    expect(cancelled.session.status).toBe("cancelled");
  });
});

async function json(value: Promise<Response> | Response) {
  const response = await value;
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return response.json() as Promise<any>;
}
