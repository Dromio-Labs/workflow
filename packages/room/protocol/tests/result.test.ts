import { describe, expect, test } from "bun:test";
import {
  isWorkflowResultPresentation,
  normalizeWorkflowResultPresentation,
  workflowResultToJsonRenderDocument,
} from "../src/index.js";

describe("workflow result protocol helpers", () => {
  test("passes through valid workflow result presentations", () => {
    const result = {
      kind: "json-render",
      document: {
        component: "ImageBatchSummary",
        props: {
          imageCount: 42,
          pendingApproval: false,
        },
      },
      title: "Image batch summary",
    } as const;

    expect(isWorkflowResultPresentation(result)).toBe(true);
    expect(normalizeWorkflowResultPresentation(result)).toBe(result);
  });

  test("normalizes JSON Render documents into result presentations", () => {
    expect(normalizeWorkflowResultPresentation({
      component: "ImageBatchSummary",
      props: {
        imageCount: 42,
        pendingApproval: true,
      },
    }, {
      title: "Image batch summary",
    })).toEqual({
      document: {
        component: "ImageBatchSummary",
        props: {
          imageCount: 42,
          pendingApproval: true,
        },
      },
      kind: "json-render",
      title: "Image batch summary",
    });
  });

  test("normalizes strings into markdown results", () => {
    expect(normalizeWorkflowResultPresentation("Images processed.", {
      title: "Summary",
    })).toEqual({
      kind: "markdown",
      title: "Summary",
      value: "Images processed.",
    });
  });

  test("normalizes JSON values into JSON Render inspector results by default", () => {
    const result = normalizeWorkflowResultPresentation({
      imageCount: 42,
      ok: true,
    }, {
      title: "Workflow outputs",
    });

    expect(result).toEqual({
      document: {
        component: "JsonInspector",
        props: {
          title: "Workflow outputs",
          value: {
            imageCount: 42,
            ok: true,
          },
        },
      },
      kind: "json-render",
      title: "Workflow outputs",
    });
    expect(result && workflowResultToJsonRenderDocument(result)).toEqual({
      component: "JsonInspector",
      props: {
        title: "Workflow outputs",
        value: {
          imageCount: 42,
          ok: true,
        },
      },
    });
  });

  test("can preserve raw JSON result presentations for legacy adapters", () => {
    expect(normalizeWorkflowResultPresentation({
      output: "raw",
    }, {
      fallbackKind: "json",
      title: "Workflow outputs",
    })).toEqual({
      kind: "json",
      title: "Workflow outputs",
      value: {
        output: "raw",
      },
    });
  });

  test("rejects malformed or non-JSON result values", () => {
    expect(isWorkflowResultPresentation({ kind: "json" })).toBe(false);
    expect(normalizeWorkflowResultPresentation(() => "not-json")).toBeUndefined();
  });
});
