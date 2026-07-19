import { describe, expect, test } from "bun:test";
import {
  createWorkflowControlPlaneHttpAdapter,
  jsonRenderFromJsonSchema,
  triggerInputJsonRender,
  type TriggerDescriptor,
} from "@dromio/workflow/workflow-control-plane";

describe("trigger json-render projection", () => {
  test("keeps explicit json-render metadata", () => {
    const jsonRender = {
      fields: [{ label: "Goal", name: "goal", type: "textarea" }],
      schemaVersion: 1,
      type: "form",
    };

    expect(triggerInputJsonRender({
      jsonRender,
      jsonSchema: {
        properties: {
          goal: { type: "string" },
        },
        type: "object",
      },
      mode: "body",
    })).toBe(jsonRender);
  });

  test("derives form fields from object json schema", () => {
    expect(jsonRenderFromJsonSchema({
      properties: {
        dryRun: {
          description: "Do not write files.",
          type: "boolean",
        },
        limit: {
          default: 5,
          title: "Maximum files",
          type: "integer",
        },
        metadata: {
          example: { source: "demo" },
          type: "object",
        },
        rootDir: {
          examples: ["."],
          type: "string",
        },
      },
      required: ["rootDir"],
      type: "object",
    })).toMatchObject({
      fields: [
        {
          label: "Dry Run",
          name: "dryRun",
          required: false,
          type: "checkbox",
          valueType: "boolean",
        },
        {
          defaultValue: 5,
          label: "Maximum files",
          name: "limit",
          type: "number",
          valueType: "number",
        },
        {
          label: "Metadata",
          name: "metadata",
          placeholder: "{\"source\":\"demo\"}",
          type: "textarea",
          valueType: "json",
        },
        {
          label: "Root Dir",
          name: "rootDir",
          placeholder: ".",
          required: true,
          type: "text",
          valueType: "string",
        },
      ],
      schemaVersion: 1,
      submitLabel: "Run workflow",
      type: "form",
    });
  });

  test("merges top-level and allOf object json schema fields", () => {
    expect(jsonRenderFromJsonSchema({
      allOf: [
        {
          properties: {
            outputDir: {
              title: "Output directory",
              type: "string",
            },
          },
          required: ["outputDir"],
          type: "object",
        },
        {
          properties: {
            flag: {
              description: "Enables the flag.",
            },
            dryRun: {
              title: "Dry run",
              type: "boolean",
            },
          },
          type: "object",
        },
      ],
      properties: {
        rootDir: {
          title: "Root directory",
          type: "string",
        },
        flag: {
          title: "Flag",
          type: "boolean",
        },
      },
      required: ["rootDir"],
      type: "object",
    })).toMatchObject({
      fields: [
        {
          label: "Root directory",
          name: "rootDir",
          required: true,
        },
        {
          description: "Enables the flag.",
          label: "Flag",
          name: "flag",
          required: false,
          type: "checkbox",
          valueType: "boolean",
        },
        {
          label: "Output directory",
          name: "outputDir",
          required: true,
        },
        {
          label: "Dry run",
          name: "dryRun",
          required: false,
          type: "checkbox",
        },
      ],
    });
  });

  test("serves derived json-render metadata from the trigger input-form endpoint", async () => {
    const trigger: TriggerDescriptor = {
      enabled: true,
      id: "schema-only.request",
      input: {
        jsonSchema: {
          properties: {
            rootDir: {
              title: "Root directory",
              type: "string",
            },
            dryRun: {
              title: "Dry run",
              type: "boolean",
            },
          },
          required: ["rootDir"],
          type: "object",
        },
        mode: "body",
      },
      label: "Schema only",
      type: "http",
      workflowId: "schema-only",
    };
    const http = createWorkflowControlPlaneHttpAdapter({
      controlPlane: {
        authorize: async () => undefined,
        getTrigger: async () => trigger,
      } as any,
    });

    const response = await http.fetch(new Request("http://local/api/triggers/schema-only.request/input-form"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonRender: {
        fields: [
          {
            label: "Root directory",
            name: "rootDir",
            required: true,
            type: "text",
          },
          {
            label: "Dry run",
            name: "dryRun",
            type: "checkbox",
          },
        ],
      },
      jsonSchema: trigger.input?.jsonSchema,
    });
  });
});
