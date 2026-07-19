import { describe, expect, test } from "bun:test";

import { ask, done, loop, retry } from "../../src/sdk/core/loop/index.js";

/**
 * Golden execution trace for the loop engine.
 *
 * This pins the observable behavior of the effectful internals — step
 * sequencing, retry accounting, question hooks, answer resume, and event
 * emission — ahead of the Plan 29 Phase 6 Effect migration. The migration
 * must not change a single element of these traces (timestamps and
 * correlation ids are normalized). If this test needs editing during that
 * migration, the migration is wrong.
 */

type NormalizedEvent = {
  readonly index: number;
  readonly message: string;
  readonly stepId?: string;
  readonly type: string;
};

function normalize(events: readonly {
  index: number;
  message: string;
  stepId?: string;
  type: string;
}[]): NormalizedEvent[] {
  return events.map((event) => ({
    index: event.index,
    message: event.message
      .replace(/hook:[\w:.-]+/g, "<hook>")
      .replace(/run_[0-9a-f-]+/g, "<run>")
      .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, "<time>"),
    ...(event.stepId ? { stepId: event.stepId } : {}),
    type: event.type,
  }));
}

function goldenLoop() {
  let flakyAttempts = 0;
  return loop({
    id: "golden-trace",
    steps: [
      {
        id: "classify",
        run: () => done({ severity: "high" }),
      },
      {
        id: "flaky-enrich",
        maxRetries: 2,
        run: () => {
          flakyAttempts += 1;
          if (flakyAttempts < 2) {
            return retry("transient enrichment failure");
          }
          return done({ enriched: true });
        },
      },
      {
        id: "clarify",
        run: (context: { answers: Record<string, unknown> }) => {
          if (context.answers["clarify.reason"] === undefined) {
            return ask({
              id: "clarify.reason",
              prompt: "Why escalate?",
              type: "text",
            });
          }
          return done({ reason: context.answers["clarify.reason"] });
        },
      },
      {
        id: "finish",
        run: () => done({ ok: true }),
      },
    ],
  });
}

describe("loop engine golden trace", () => {
  test("step, retry, question, answer-resume, and completion trace is stable", async () => {
    const session = await goldenLoop().start({ ticketId: "T-1" });

    expect(session.status).toBe("waiting");
    expect(session.pendingQuestions.map((question: { id: string }) => question.id)).toEqual([
      "clarify.reason",
    ]);

    const waitingTrace = normalize(session.events);

    await session.answer({ questionId: "clarify.reason", value: "customer at risk" });
    await session.resume();

    expect(session.status).toBe("completed");
    const finalTrace = normalize(session.events);

    // The waiting-phase trace is a strict prefix of the final trace: the
    // resume must append, never rewrite history.
    expect(finalTrace.slice(0, waitingTrace.length)).toEqual(waitingTrace);

    expect(finalTrace.map((event) => `${event.type}${event.stepId ? `:${event.stepId}` : ""}`))
      .toMatchSnapshot("golden-trace-event-sequence");
    expect(finalTrace).toMatchSnapshot("golden-trace-full");

    // Retry accounting is part of the contract.
    expect(session.retryCounts.get("flaky-enrich") ?? 0).toBe(1);
  });

  test("checkpoints capture resumable state at the question boundary", async () => {
    const session = await goldenLoop().start({ ticketId: "T-2" });

    expect(session.checkpoints.length).toBeGreaterThan(0);
    const checkpointSteps = session.checkpoints.map((checkpoint: { stepId?: string }) =>
      (checkpoint as { stepId?: string }).stepId ?? "unknown"
    );
    expect(checkpointSteps).toMatchSnapshot("golden-trace-checkpoint-steps");
  });
});
