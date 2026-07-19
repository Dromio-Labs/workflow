import { expect, test } from "bun:test";
import { defaultFormatEvent } from "@dromio/workflow/client";
import type { EventRecord } from "@dromio/workflow/core";

test("verbose terminal traces render fork branches and joins", () => {
  expect(defaultFormatEvent(event("fork.started", "Forking 2 branches."))).toMatchObject({
    phaseTitle: "Fork",
    status: "running",
  });
  expect(defaultFormatEvent(event("fork.branch.completed", "Completed assessment.", {
    branchId: "assessment",
  }))).toMatchObject({
    children: ["branch: assessment"],
    phaseTitle: "Fork Branch",
    status: "ok",
  });
  expect(defaultFormatEvent(event("join.completed", "Joined 2 branch results."))).toMatchObject({
    phaseTitle: "Join",
    status: "ok",
  });
});

function event(
  type: string,
  message: string,
  detail?: Record<string, unknown>,
): EventRecord {
  return {
    at: Date.now(),
    correlationId: "correlation-fork-format",
    detail,
    index: 1,
    message,
    runId: "run-fork-format",
    stepId: "review-response",
    timestamp: new Date(0).toISOString(),
    type,
  };
}
