import { describe, expect, test } from "bun:test";
import {
  encodeWorkflowTriggerSubmission,
  normalizeWorkflowTriggerInput,
  workflowTriggerInputTerminalLines,
} from "../src/index.js";

describe("workflow trigger input protocol", () => {
  test("normalizes an absent descriptor to an automatic trigger", () => {
    expect(normalizeWorkflowTriggerInput()).toEqual({ kind: "none", required: false });
  });

  test("projects adapter-neutral terminal guidance", () => {
    expect(workflowTriggerInputTerminalLines({
      accept: ["image/png", "application/pdf"],
      kind: "artifact",
      multiple: true,
      required: true,
    })).toEqual(["Input: files (required) · image/png, application/pdf"]);
  });

  test("encodes structured submissions for string-based runtimes", () => {
    expect(encodeWorkflowTriggerSubmission({ value: { topic: "traces" } }))
      .toBe('{"topic":"traces"}');
  });
});
