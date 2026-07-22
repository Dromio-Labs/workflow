import { describe, expect, test } from "bun:test";
import { assertHookOutput, HookOutputValidationError } from "@dromio/workflow/core";

describe("hook output validation", () => {
  test("enforces standard JSON Schema formats before consuming a hook", () => {
    const hook = {
      id: "delegated-source",
      kind: "handoff_requested",
      schema: { format: "uri", type: "string" },
    };

    expect(() => assertHookOutput(hook, "not a url"))
      .toThrow(HookOutputValidationError);
    expect(() => assertHookOutput(hook, "https://modelcontextprotocol.io/extensions/apps/build"))
      .not.toThrow();
  });
});
