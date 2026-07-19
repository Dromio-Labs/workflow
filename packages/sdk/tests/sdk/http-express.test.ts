import { describe, expect, test } from "bun:test";
import { createExpressRouter } from "@dromio/workflow/client";
import {
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import { createIntentRuntime } from "@dromio/workflow/core";

describe("intent http express adapter", () => {
  test("creates an Express-like router without requiring Express as a dependency", () => {
    const calls: Array<{ path: string }> = [];
    const express = {
      Router() {
        return {
          all(path: string) {
            calls.push({ path });
          },
        };
      },
    };
    const runtime = createIntentRuntime({
      workflows: {
        demo: loop({
          id: "demo",
          steps: [createRuntimeStep("done", () => done())],
        }),
      },
    });

    const router = createExpressRouter({ express, runtime });

    expect(router).toBeDefined();
    expect(calls).toEqual([{ path: "*" }]);
  });
});
