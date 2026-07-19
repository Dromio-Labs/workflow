import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
  projectWorkflowGraphRenderModel,
  projectWorkflowRun,
} from "@dromio/workflow/client";
import {
  ask,
  defineOperationContract,
  done,
  loop,
  createContractedRuntimeStep,
  createRuntimeStep,
} from "@dromio/workflow/core";
import {
  compileWorkflowDocument,
  createWorkflowDocumentRenderer,
  createWorkflowCatalog,
  createWorkflowDocument,
  createWorkflowEditor,
  createWorkflowWorkspace,
  createResolveWorkflowNodeStep,
  defineCatalogItem,
  end,
  persistWorkflowWorkspaceFrame,
  publishWorkflowWorkspaceFrame,
  trigger,
  validateWorkflowDocument,
  workflowDocumentSchema,
  workflowEditor,
} from "@dromio/workflow/product";
import {
  runChildWorkflow,
  runForEachWorkflow,
} from "../../src/sdk/product/workflow/child-workflow.js";

const promptSchema = z.string().trim().min(1);
const promptJsonSchema = {
  minLength: 1,
  type: "string",
};
const longPromptSchema = z.string().trim().min(5);
const promptPayloadSchema = z.object({ prompt: z.string() });
const textSchema = z.object({ text: z.string() });
const stringOrNumberSchema = defineOperationContract({
  id: "testing.string-or-number",
  jsonSchema: {
    anyOf: [
      {
        type: "string",
      },
      {
        type: "number",
      },
    ],
  },
});
const textJsonSchema = {
  properties: {
    text: {
      type: "string",
    },
  },
  required: ["text"],
  type: "object",
};

const echoCatalogItem = defineCatalogItem({
  tools: ["testing", "transform"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "echo",
      input: {
        prompt: promptSchema,
      },
      output: {
        result: textSchema,
      },
      run(context) {
        return done({
          result: {
            text: `Echo ${context.input.prompt}`,
          },
        });
      },
    });
  },
  description: "Echoes a prompt into a structured text result.",
  examples: [
    {
      userIntent: "turn text into an echo result",
    },
  ],
  id: "testing.echo",
  inputs: {
    prompt: promptSchema,
  },
  intents: ["echo a prompt", "turn text into a result"],
  kind: "step",
  label: "Echo prompt",
  outputs: {
    result: textSchema,
  },
  verbs: ["echo", "transform"],
});

const uppercaseCatalogItem = defineCatalogItem({
  tools: ["testing", "transform"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "uppercase-result",
      input: {
        result: textSchema,
      },
      output: {
        finalResult: textSchema,
      },
      run(context) {
        return done({
          finalResult: {
            text: context.input.result.text.toUpperCase(),
          },
        });
      },
    });
  },
  description: "Uppercases a structured text result.",
  id: "testing.uppercase-result",
  inputs: {
    result: textSchema,
  },
  intents: ["uppercase a result", "transform result to uppercase"],
  kind: "step",
  label: "Uppercase result",
  outputs: {
    finalResult: textSchema,
  },
  verbs: ["uppercase", "transform"],
});

const payloadCatalogItem = defineCatalogItem({
  tools: ["testing", "payload"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "payload",
      input: {
        payload: textSchema,
      },
      output: {
        result: textSchema,
      },
      run(context) {
        return done({
          result: context.input.payload,
        });
      },
    });
  },
  id: "testing.payload",
  inputs: {
    payload: textSchema,
  },
  kind: "step",
  label: "Payload",
  outputs: {
    result: textSchema,
  },
});

const unionOutputCatalogItem = defineCatalogItem({
  tools: ["testing", "union"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "union",
      input: {
        prompt: promptSchema,
      },
      output: {
        value: stringOrNumberSchema,
      },
      run() {
        return done({
          value: "ok",
        });
      },
    });
  },
  id: "testing.union-output",
  inputs: {
    prompt: promptSchema,
  },
  kind: "step",
  label: "Union output",
  outputs: {
    value: stringOrNumberSchema,
  },
});

const longPromptCatalogItem = defineCatalogItem({
  tools: ["testing", "constraints"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "long-prompt",
      input: {
        prompt: longPromptSchema,
      },
      output: {
        result: textSchema,
      },
      run(context) {
        return done({
          result: {
            text: context.input.prompt,
          },
        });
      },
    });
  },
  id: "testing.long-prompt",
  inputs: {
    prompt: longPromptSchema,
  },
  kind: "step",
  label: "Long prompt",
  outputs: {
    result: textSchema,
  },
});

const promptPayloadCatalogItem = defineCatalogItem({
  tools: ["testing", "constraints"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "prompt-payload",
      input: {
        request: promptPayloadSchema,
      },
      output: {
        result: textSchema,
      },
      run(context) {
        return done({
          result: {
            text: context.input.request.prompt,
          },
        });
      },
    });
  },
  id: "testing.prompt-payload",
  inputs: {
    request: promptPayloadSchema,
  },
  kind: "step",
  label: "Prompt payload",
  outputs: {
    result: textSchema,
  },
});

const emailCatalogItem = defineCatalogItem({
  tools: ["testing", "constraints"],
  create(input = {}) {
    return createContractedRuntimeStep({
      id: input.stepId ?? "email",
      input: {
        email: defineOperationContract({
          id: "testing.email.input",
          jsonSchema: {
            format: "email",
            type: "string",
          },
        }),
      },
      output: {
        result: textSchema,
      },
      run(context) {
        return done({
          result: {
            text: String(context.input.email),
          },
        });
      },
    });
  },
  id: "testing.email",
  inputs: {
    email: defineOperationContract({
      id: "testing.email.catalog-input",
      jsonSchema: {
        format: "email",
        type: "string",
      },
    }),
  },
  kind: "step",
  label: "Email",
  outputs: {
    result: textSchema,
  },
});

function formatCatalogItem(format: string) {
  return defineCatalogItem({
    tools: ["testing", "constraints"],
    create(input = {}) {
      return createContractedRuntimeStep({
        id: input.stepId ?? format,
        input: {
          value: defineOperationContract({
            id: `testing.${format}.input`,
            jsonSchema: {
              format,
              type: "string",
            },
          }),
        },
        output: {
          result: textSchema,
        },
        run(context) {
          return done({
            result: {
              text: String(context.input.value),
            },
          });
        },
      });
    },
    id: `testing.${format}`,
    inputs: {
      value: defineOperationContract({
        id: `testing.${format}.catalog-input`,
        jsonSchema: {
          format,
          type: "string",
        },
      }),
    },
    kind: "step",
    label: format,
    outputs: {
      result: textSchema,
    },
  });
}

describe("workflow document", () => {
  test("projects configured trigger and end boundaries into workflow run views", async () => {
    const app = compileWorkflowDocument({
      catalog: createWorkflowCatalog([echoCatalogItem]),
      document: createWorkflowDocument({
        end: {
          description: "The echo result is ready.",
          id: "result-ready",
          label: "Result ready",
          output: {
            result: {
              jsonSchema: textJsonSchema,
            },
          },
        },
        id: "document.echo",
        label: "Document Echo",
        nodes: [
          {
            catalogItemId: "testing.echo",
            id: "echo",
          },
        ],
        trigger: {
          description: "User provides the prompt.",
          id: "prompt",
          input: {
            prompt: {
              jsonSchema: promptJsonSchema,
            },
          },
          label: "Prompt",
          type: "manual",
        },
      }),
    });

    const graph = app.graph();
    expect(graph.trigger).toMatchObject({
      id: "prompt",
      label: "Prompt",
      type: "manual",
    });
    expect(graph.end).toMatchObject({
      id: "result-ready",
      label: "Result ready",
    });
    expect(graph.trigger?.input?.[0]).toMatchObject({
      key: "prompt",
    });
    expect(graph.end?.output?.[0]).toMatchObject({
      key: "result",
    });
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["prompt", "echo"],
      ["echo", "result-ready"],
    ]);

    const projection = projectWorkflowRun({
      events: [],
      graph,
    });
    expect(projection.steps.map((item) => [item.id, item.label, item.boundary])).toEqual([
      ["prompt", "Prompt", "trigger"],
      ["echo", "Echo", undefined],
      ["result-ready", "Result ready", "end"],
    ]);

    const session = await app.start("ship");
    expect(session.status).toBe("completed");
    expect(session.state.result).toEqual({ text: "Echo ship" });
  });

  test("derives nested child nodes from child workflow documents before catalog children fallback", () => {
    const legacyCatalogItem = defineCatalogItem({
      create(input = {}) {
        return createRuntimeStep(input.stepId ?? "legacy", () => done());
      },
      id: "testing.legacy-child",
      kind: "step",
      label: "Legacy child",
    });
    const parentCatalogItem = defineCatalogItem({
      create(input = {}) {
        return createRuntimeStep(input.stepId ?? "parent", () => done());
      },
      execution: {
        childWorkflowDocumentId: "document.child",
        itemSource: "items",
        kind: "forEach",
      },
      id: "testing.child-workflow-parent",
      implementation: {
        children: ["testing.legacy-child"],
        kind: "workflow-document",
        workflowDocumentId: "document.child",
      },
      kind: "composite",
      label: "Child workflow parent",
    });
    const catalog = createWorkflowCatalog([echoCatalogItem, legacyCatalogItem, parentCatalogItem]);
    const parentDocument = createWorkflowDocument({
      end: { id: "done" },
      id: "document.parent",
      nodes: [{ catalogItemId: "testing.child-workflow-parent", id: "parent" }],
      trigger: { id: "start", type: "manual" },
    });
    const childDocument = createWorkflowDocument({
      end: { id: "child-done" },
      id: "document.child",
      loops: [{
        backTo: "echo-child",
        end: "echo-review",
        id: "child-review-loop",
        start: "echo-child",
      }],
      nodes: [
        { catalogItemId: "testing.echo", id: "echo-child", label: "Echo from child workflow" },
        { catalogItemId: "testing.echo", id: "echo-review", label: "Review child workflow" },
      ],
      trigger: { id: "child-start", type: "manual" },
    });

    const derived = compileWorkflowDocument({
      catalog,
      childWorkflows: {
        "document.child": {
          catalog,
          document: childDocument,
        },
      },
      document: parentDocument,
    }).graph().nodes.find((node) => node.id === "parent");

    expect(derived?.childNodes).toEqual([
      expect.objectContaining({
        catalogItemId: "testing.echo",
        id: "echo-child",
        label: "Echo from child workflow",
        loop: expect.objectContaining({
          backToNodeId: "echo-child",
          id: "child-review-loop",
          role: "start",
        }),
      }),
      expect.objectContaining({
        catalogItemId: "testing.echo",
        id: "echo-review",
        label: "Review child workflow",
        loop: expect.objectContaining({
          backToNodeId: "echo-child",
          id: "child-review-loop",
          role: "end",
        }),
      }),
    ]);
    expect(derived?.childNodes?.some((node) => node.catalogItemId === "testing.legacy-child")).toBe(false);

    const fallback = compileWorkflowDocument({
      catalog,
      document: parentDocument,
    }).graph().nodes.find((node) => node.id === "parent");

    expect(fallback?.childNodes).toEqual([
      expect.objectContaining({
        catalogItemId: "testing.legacy-child",
        id: "testing.legacy-child",
        label: "Legacy child",
      }),
    ]);
  });

  test("projects fork branch workflow documents without cross-branch sequence edges", () => {
    const forkItem = defineCatalogItem({
      create(input = {}) {
        return createRuntimeStep(input.stepId ?? "fork", () => done());
      },
      execution: {
        branches: [
          { childWorkflowDocumentId: "branch.assessment", id: "assessment" },
          { childWorkflowDocumentId: "branch.analysis", id: "analysis" },
        ],
        kind: "fork",
      },
      id: "testing.fork",
      kind: "composite",
      label: "Fork",
    });
    const catalog = createWorkflowCatalog([echoCatalogItem, forkItem]);
    const childDocument = (id: string, nodeIds: string[]) => createWorkflowDocument({
      end: { id: `${id}.done` },
      id,
      nodes: nodeIds.map((nodeId) => ({ catalogItemId: "testing.echo", id: nodeId })),
      trigger: { id: `${id}.start`, type: "manual" },
    });
    const workflow = compileWorkflowDocument({
      catalog,
      childWorkflows: {
        "branch.analysis": { catalog, document: childDocument("branch.analysis", ["inspect"]) },
        "branch.assessment": { catalog, document: childDocument("branch.assessment", ["assess", "score"]) },
      },
      document: createWorkflowDocument({
        end: { id: "done" },
        id: "document.fork-parent",
        nodes: [{ catalogItemId: "testing.fork", id: "fork" }],
        trigger: { id: "start", type: "manual" },
      }),
    });
    const graph = workflow.graph();
    const forkNode = graph.nodes.find((node) => node.id === "fork");

    expect(forkNode?.childNodes).toEqual([
      expect.objectContaining({ branch: expect.objectContaining({ id: "assessment" }), id: "assessment.assess" }),
      expect.objectContaining({ branch: expect.objectContaining({ id: "assessment" }), id: "assessment.score" }),
      expect.objectContaining({ branch: expect.objectContaining({ id: "analysis" }), id: "analysis.inspect" }),
    ]);
    const renderedFork = projectWorkflowGraphRenderModel({ graph }).nodes
      .find((node) => node.id === "fork")?.childWorkflow?.model;
    expect(renderedFork?.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["fork.fork:initial", "fork.fork:trigger"],
      ["fork.fork:trigger", "assessment.assess"],
      ["assessment.assess", "assessment.score"],
      ["assessment.score", "fork.fork:end"],
      ["fork.fork:trigger", "analysis.inspect"],
      ["analysis.inspect", "fork.fork:end"],
    ]);
  });

  test("projects router child workflows as exclusive route and merge edges", () => {
    const routerItem = defineCatalogItem({
      create(input = {}) {
        return createRuntimeStep(input.stepId ?? "router", () => done());
      },
      execution: {
        kind: "router",
        routes: [
          { childWorkflowDocumentId: "route.note", id: "note", label: "Note" },
          { childWorkflowDocumentId: "route.voice", id: "voice", label: "Voice" },
        ],
      },
      id: "testing.router",
      kind: "router",
      label: "Router",
    });
    const catalog = createWorkflowCatalog([echoCatalogItem, routerItem]);
    const childDocument = (id: string, nodeId: string) => createWorkflowDocument({
      end: { id: `${id}.done` },
      id,
      nodes: [{ catalogItemId: "testing.echo", id: nodeId }],
      trigger: { id: `${id}.start`, type: "manual" },
    });
    const workflow = compileWorkflowDocument({
      catalog,
      childWorkflows: {
        "route.note": { catalog, document: childDocument("route.note", "normalize") },
        "route.voice": { catalog, document: childDocument("route.voice", "transcribe") },
      },
      document: createWorkflowDocument({
        end: { id: "done" },
        id: "document.router-parent",
        nodes: [{ catalogItemId: "testing.router", id: "router" }],
        trigger: { id: "start", type: "manual" },
      }),
    });
    const routerNode = workflow.graph().nodes.find((node) => node.id === "router");

    expect(routerNode?.childNodes).toEqual([
      expect.objectContaining({ id: "note.normalize", route: { id: "note", label: "Note" } }),
      expect.objectContaining({ id: "voice.transcribe", route: { id: "voice", label: "Voice" } }),
    ]);
    const rendered = projectWorkflowGraphRenderModel({ graph: workflow.graph() }).nodes
      .find((node) => node.id === "router")?.childWorkflow?.model;
    expect(rendered?.edges.map((edge) => [edge.source, edge.target, edge.metadata.kind])).toEqual([
      ["router.router:initial", "router.router:trigger", "sequence"],
      ["router.router:trigger", "note.normalize", "route"],
      ["note.normalize", "router.router:end", "merge"],
      ["router.router:trigger", "voice.transcribe", "route"],
      ["voice.transcribe", "router.router:end", "merge"],
    ]);
  });

  test("runs child workflows with parent trace metadata and sequential for-each iterations", async () => {
    const childWorkflow = loop({
      id: "document.child-runtime",
      steps: [
        createRuntimeStep("child-step", () => done({ childResult: "ok" }), {
          label: "Child step",
        }),
      ],
    });
    const parentWorkflow = loop({
      id: "document.parent-runtime",
      steps: [
        createRuntimeStep("parent", async ({ emit, step: runtimeStep }) => {
          const order: string[] = [];
          await runChildWorkflow({
            childWorkflowId: "document.child-runtime",
            emit,
            input: {},
            iterationIndex: 0,
            iterationLabel: "single",
            iterationTotal: 1,
            parentStepId: runtimeStep.id,
            parentTrace: {
              spanId: `step:${runtimeStep.id}:attempt:${runtimeStep.attempt}`,
              traceId: runtimeStep.runId,
            },
            phase: "child workflow",
            stepIdPrefix: "single",
            workflow: childWorkflow,
          });
          await runForEachWorkflow({
            childWorkflowId: "document.child-runtime",
            emit,
            input: () => ({}),
            itemId: (item) => `item-${item}`,
            itemKind: "thing",
            itemLabel: (item) => item,
            items: ["a", "b"],
            onItemCompleted(context) {
              order.push(`done:${context.item}`);
            },
            onItemStarted(context) {
              order.push(`start:${context.item}`);
            },
            parentStepId: runtimeStep.id,
            parentTrace: {
              spanId: `step:${runtimeStep.id}:attempt:${runtimeStep.attempt}`,
              traceId: runtimeStep.runId,
            },
            workflow: () => childWorkflow,
          });
          return done({ order });
        }),
      ],
    });

    const session = await parentWorkflow.start({});
    expect(session.state.order).toEqual(["start:a", "done:a", "start:b", "done:b"]);

    const singleChildStarted = session.events.find((event) =>
      event.type === "step.started" && event.stepId === "single.child-step"
    );
    expect(singleChildStarted).toMatchObject({
      detail: expect.objectContaining({
        childWorkflowId: "document.child-runtime",
        itemWorkflowStepId: "child-step",
        iterationIndex: 0,
        iterationLabel: "single",
        iterationTotal: 1,
        parentStepId: "parent",
      }),
      trace: expect.objectContaining({
        parentSpanId: "step:parent:attempt:1",
        traceId: session.runId,
      }),
    });

    const iterationEvents = session.events.filter((event) =>
      event.type === "step.completed" && event.stepId?.endsWith(".child-step")
    );
    expect(iterationEvents.map((event) => (event.detail as { iterationIndex?: number }).iterationIndex)).toEqual([
      0,
      0,
      1,
    ]);
    expect(iterationEvents.at(-1)).toMatchObject({
      detail: expect.objectContaining({
        itemId: "item-b",
        itemKind: "thing",
        itemWorkflowStepId: "child-step",
        iterationLabel: "b",
        iterationTotal: 2,
      }),
    });
  });

  test("rejects child workflows that wait for input in v1", async () => {
    const waitingChildWorkflow = loop({
      id: "document.waiting-child",
      steps: [
        createRuntimeStep("ask-child", () => ask({
          id: "child-question",
          prompt: "Need child input",
          title: "Child input",
          type: "text",
        })),
      ],
    });

    await expect(runChildWorkflow({
      childWorkflowId: "document.waiting-child",
      input: {},
      workflow: waitingChildWorkflow,
    })).rejects.toThrow(/waiting for input/);
  });

  test("edits, validates, searches, and compiles documents", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const document = createWorkflowDocument({
      end: {
        id: "done",
        label: "Done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.editable",
      nodes: [],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: promptJsonSchema,
          },
        },
        type: "manual",
      },
    });
    const editor = createWorkflowEditor(document);

    editor.addStep({
      catalogItemId: "testing.echo",
      id: "echo",
    });
    editor.updateStepConfig("echo", { tone: "plain" });
    editor.updateTrigger({ label: "Prompt" });

    expect(editor.validate({ catalog })).toEqual({ issues: [], ok: true });
    expect(catalog.search({
      inputKeys: ["prompt"],
      intent: "echo this prompt into a result",
      verbs: ["echo"],
    })[0]).toMatchObject({
      item: {
        id: "testing.echo",
      },
    });

    const app = editor.compile({ catalog });
    expect(app.graph().trigger?.label).toBe("Prompt");
    expect(app.graph().nodes.find((node) => node.id === "echo")?.label).toBe("Echo");
  });

  test("streams workflow document patches into visible workspace frames", async () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const workspace = createWorkflowWorkspace({
      catalog,
      document: createWorkflowDocument({
        end: {
          id: "done",
          output: {
            result: {
              jsonSchema: textJsonSchema,
            },
          },
        },
        id: "document.workspace",
        nodes: [],
        trigger: {
          id: "prompt",
          input: {
            prompt: {
              jsonSchema: promptJsonSchema,
            },
          },
          type: "manual",
        },
      }),
      id: "workspace.visible",
    });
    const renderer = createWorkflowDocumentRenderer({ workspace });
    const frames = [];

    for await (const frame of renderer.consume([
      {
        patch: {
          op: "add",
          path: "/nodes/0",
          value: {
            catalogItemId: "testing.echo",
            id: "echo",
          },
        },
        source: "llm",
        target: "document",
      },
      {
        patch: {
          op: "replace",
          path: "/edges",
          value: [
            {
              id: "prompt->echo",
              source: "prompt",
              target: "echo",
            },
            {
              id: "echo->done",
              source: "echo",
              target: "done",
            },
          ],
        },
        source: "llm",
        target: "document",
      },
      {
        patch: {
          op: "add",
          path: "/nodes/0/label",
          value: "Echo it",
        },
        scope: {
          nodeId: "echo",
          phase: "label",
        },
        source: "system",
        target: "document",
      },
    ])) {
      frames.push(frame);
    }

    expect(frames.map((frame) => frame.status)).toEqual(["draft", "valid", "valid"]);
    expect(frames[0]?.validation.issues.map((issue) => issue.code)).toContain("node.unreachable");
    expect(frames[2]?.compiledGraph?.nodes.find((node) => node.id === "echo")).toMatchObject({
      label: "Echo it",
    });
    expect(workspace.patches()).toHaveLength(3);
    expect(workspace.publish({ version: "v1" }).status).toBe("published");
  });

  test("keeps invalid workflow edits inspectable instead of hiding failed patches", () => {
    const workspace = createWorkflowWorkspace({
      catalog: createWorkflowCatalog([echoCatalogItem]),
      document: createWorkflowDocument({
        end: {
          id: "done",
          output: {
            result: {
              jsonSchema: textJsonSchema,
            },
          },
        },
        id: "document.workspace-invalid",
        nodes: [
          {
            catalogItemId: "testing.echo",
            id: "echo",
          },
        ],
        trigger: {
          id: "prompt",
          input: {
            prompt: {
              jsonSchema: promptJsonSchema,
            },
          },
          type: "manual",
        },
      }),
      id: "workspace.invalid",
    });

    expect(workspace.status()).toBe("valid");

    const invalidCatalogFrame = workspace.applyPatch({
      patch: {
        op: "replace",
        path: "/nodes/0/catalogItemId",
        value: "testing.missing",
      },
      source: "human",
      target: "document",
    });

    expect(invalidCatalogFrame.status).toBe("draft");
    expect(invalidCatalogFrame.validation.issues.map((issue) => issue.code)).toContain("catalog.missing-item");
    expect(() => workspace.publish()).toThrow(/Cannot publish invalid workflow workspace/);

    const repaired = workspace.applyPatch({
      patch: {
        op: "replace",
        path: "/nodes/0/catalogItemId",
        value: "testing.echo",
      },
      source: "human",
      target: "document",
    });
    expect(repaired.status).toBe("valid");

    const failedPatch = workspace.applyPatch({
      patch: {
        op: "remove",
        path: "/nodes/99",
      },
      source: "llm",
      target: "document",
    });

    expect(failedPatch.status).toBe("draft");
    expect(failedPatch.latestPatch?.validationAfter?.issues.map((issue) => issue.code)).toContain("patch.apply");
    expect(workspace.undo().status).toBe("valid");
    expect(workspace.redo().validation.issues.map((issue) => issue.code)).toContain("patch.apply");
  });

  test("stages workflow patch proposals before accepting or rejecting them", () => {
    const workspace = createWorkflowWorkspace({
      catalog: createWorkflowCatalog([echoCatalogItem]),
      document: {
        edges: [{
          id: "prompt-to-ready",
          source: "prompt",
          target: "ready",
        }],
        end: {
          id: "ready",
          label: "Ready",
          output: {
            result: {
              jsonSchema: textJsonSchema,
            },
          },
          type: "result",
        },
        id: "proposal-workspace",
        label: "Proposal Workspace",
        nodes: [],
        trigger: {
          id: "prompt",
          input: {
            prompt: {
              jsonSchema: {
                minLength: 1,
                type: "string",
              },
            },
          },
          label: "Prompt",
          type: "manual",
        },
        version: 1,
      },
      id: "proposal-workspace",
    });

    const proposed = workspace.proposePatches({
      patches: [
        {
          patch: {
            op: "add",
            path: "/nodes/-",
            value: {
              catalogItemId: "testing.echo",
              id: "echo",
              label: "Echo prompt",
            },
          },
          source: "llm",
          target: "document",
        },
        {
          patch: {
            op: "replace",
            path: "/edges",
            value: [
              {
                id: "prompt-to-echo",
                source: "prompt",
                target: "echo",
              },
              {
                id: "echo-to-ready",
                source: "echo",
                target: "ready",
              },
            ],
          },
          source: "llm",
          target: "document",
        },
      ],
      title: "Add echo node",
    });

    expect(proposed.patches).toEqual([]);
    expect(proposed.proposal?.title).toBe("Add echo node");
    expect(proposed.proposal?.compiledGraph?.nodes.map((node) => node.id)).toEqual(["echo"]);
    expect(workspace.frame().compiledGraph?.nodes.map((node) => node.id)).toEqual([]);
    expect(() => workspace.publish()).toThrow(/Accept or reject proposed workflow patches/);

    const accepted = workspace.acceptProposal();
    expect(accepted.proposal).toBeUndefined();
    expect(accepted.patches.length).toBe(2);
    expect(accepted.compiledGraph?.nodes.map((node) => node.id)).toEqual(["echo"]);

    const rejected = workspace.proposePatches({
      patches: [{
        patch: {
          op: "replace",
          path: "/nodes/0/label",
          value: "Rejected label",
        },
        source: "llm",
        target: "document",
      }],
    });
    expect(rejected.proposal?.parsedDocument?.nodes[0]?.label).toBe("Rejected label");
    expect(workspace.rejectProposal().parsedDocument?.nodes[0]?.label).toBe("Echo prompt");
  });

  test("persists workspace patch journals and publishes valid workflow documents", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "workflow-workspace-persist-"));
    try {
      const catalog = createWorkflowCatalog([echoCatalogItem]);
      const workspace = createWorkflowWorkspace({
        catalog,
        document: createWorkflowDocument({
          edges: [{
            id: "prompt-to-ready",
            source: "prompt",
            target: "ready",
          }],
          end: {
            id: "ready",
            output: {
              result: {
                jsonSchema: textJsonSchema,
              },
            },
          },
          id: "persisted-echo",
          nodes: [],
          trigger: {
            id: "prompt",
            input: {
              prompt: {
                jsonSchema: promptJsonSchema,
              },
            },
            type: "manual",
          },
        }),
        id: "workspace.persisted-echo",
      });
      workspace.proposePatches({
        patches: [
          {
            patch: {
              op: "add",
              path: "/nodes/-",
              value: {
                catalogItemId: "testing.echo",
                id: "echo",
              },
            },
            source: "llm",
            target: "document",
          },
          {
            patch: {
              op: "replace",
              path: "/edges",
              value: [
                { id: "prompt-to-echo", source: "prompt", target: "echo" },
                { id: "echo-to-ready", source: "echo", target: "ready" },
              ],
            },
            source: "llm",
            target: "document",
          },
        ],
        title: "Add echo node",
      });
      const frame = workspace.acceptProposal();

      await persistWorkflowWorkspaceFrame({
        directory: path.join(tempDir, ".dromio", "workspaces", frame.workspaceId),
        frame,
      });
      await publishWorkflowWorkspaceFrame({
        directory: path.join(tempDir, ".dromio", "workflows"),
        frame,
        workflowId: "persisted-echo",
      });

      const workspaceFile = JSON.parse(await readFile(
        path.join(tempDir, ".dromio", "workspaces", frame.workspaceId, "workspace.json"),
        "utf8",
      )) as { status: string; workspaceId: string };
      const patches = await readFile(
        path.join(tempDir, ".dromio", "workspaces", frame.workspaceId, "patches.jsonl"),
        "utf8",
      );
      const document = JSON.parse(await readFile(
        path.join(tempDir, ".dromio", "workflows", "persisted-echo.workflow.json"),
        "utf8",
      )) as { nodes: Array<{ id: string }> };

      expect(workspaceFile).toMatchObject({
        status: "valid",
        workspaceId: "workspace.persisted-echo",
      });
      expect(patches.trim().split("\n").length).toBe(frame.patches.length);
      expect(document.nodes.map((node) => node.id)).toEqual(["echo"]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("preserves document-authored node labels and rejects invalid boundary wiring", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const document = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.labels",
      nodes: [
        {
          catalogItemId: "testing.echo",
          description: "Document-owned description.",
          id: "echo",
          label: "Document Echo",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: promptJsonSchema,
          },
        },
        type: "manual",
      },
    });

    const app = compileWorkflowDocument({ catalog, document });
    expect(app.graph().nodes[0]).toMatchObject({
      description: "Document-owned description.",
      label: "Document Echo",
    });

    const invalid = workflowEditor.connect(document, {
      source: "done",
      target: "prompt",
    });
    const validation = validateWorkflowDocument(invalid, { catalog });
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "edge.source-end",
      "edge.target-trigger",
    ]));
  });

  test("executes serializable port bindings and validates workflow-backed node kinds", async () => {
    const catalog = createWorkflowCatalog([echoCatalogItem, uppercaseCatalogItem]);
    const document = createWorkflowDocument({
      end: {
        id: "done",
        output: { answer: { jsonSchema: textJsonSchema } },
      },
      id: "document.bindings",
      nodes: [
        {
          bindings: { input: { prompt: "request" }, output: { result: "draft" } },
          catalogItemId: "testing.echo",
          id: "echo",
          kind: "step",
        },
        {
          bindings: { input: { result: "draft" }, output: { finalResult: "answer" } },
          catalogItemId: "testing.uppercase-result",
          id: "uppercase",
          kind: "step",
        },
      ],
      trigger: {
        id: "prompt",
        input: { request: { jsonSchema: promptJsonSchema } },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(document, { catalog })).toEqual({ issues: [], ok: true });
    const session = await compileWorkflowDocument({ catalog, document }).start({ request: "hello" });
    expect(session.state.answer).toEqual({ text: "ECHO HELLO" });

    const invalidKind = {
      ...document,
      nodes: document.nodes.map((node) => node.id === "echo" ? { ...node, kind: "fork" as const } : node),
    };
    expect(validateWorkflowDocument(invalidKind, { catalog }).issues.map((issue) => issue.code))
      .toContain("node.kind-mismatch");
  });

  test("validates boundary contracts against the first and last catalog nodes", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const document = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          artifact: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.contract-mismatch",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "echo",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          text: {
            jsonSchema: {
              type: "string",
            },
          },
        },
        type: "manual",
      },
    });

    const validation = validateWorkflowDocument(document, { catalog });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch",
      "boundary.end-output-mismatch",
    ]));
  });

  test("requires typed boundary contracts when adjacent catalog nodes declare contracts", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const missingContracts = createWorkflowDocument({
      end: {
        id: "done",
      },
      id: "document.missing-boundary-contracts",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "echo",
        },
      ],
      trigger: {
        id: "prompt",
        type: "manual",
      },
    });
    const wrongSchemas = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: {
              type: "number",
            },
          },
        },
      },
      id: "document.wrong-boundary-schema",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "echo",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: {
              type: "number",
            },
          },
        },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(missingContracts, { catalog }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.missing",
      "boundary.end-output-mismatch.missing",
    ]));
    expect(validateWorkflowDocument(wrongSchemas, { catalog }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "boundary.end-output-mismatch.schema",
    ]));
    expect(() => compileWorkflowDocument({ catalog, document: missingContracts })).toThrow(/must declare keys/);
  });

  test("rejects weaker object boundary schemas than adjacent catalog node contracts", () => {
    const catalog = createWorkflowCatalog([payloadCatalogItem]);
    const weakDocument = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.weak-boundary-schema",
      nodes: [
        {
          catalogItemId: "testing.payload",
          id: "payload",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          payload: {
            jsonSchema: {
              type: "object",
            },
          },
        },
        type: "manual",
      },
    });

    const validation = validateWorkflowDocument(weakDocument, { catalog });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "node.input-schema",
    ]));
  });

  test("uses directional boundary schema assignability", () => {
    const widenedTrigger = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.widened-trigger",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "echo",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: {
              type: ["string", "number"],
            },
          },
        },
        type: "manual",
      },
    });
    const narrowedEnd = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          value: {
            jsonSchema: {
              type: "string",
            },
          },
        },
      },
      id: "document.narrowed-end",
      nodes: [
        {
          catalogItemId: "testing.union-output",
          id: "union",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: promptJsonSchema,
          },
        },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(widenedTrigger, {
      catalog: createWorkflowCatalog([echoCatalogItem]),
    }).issues.map((issue) => issue.code)).toContain("boundary.trigger-input-mismatch.schema");
    expect(validateWorkflowDocument(narrowedEnd, {
      catalog: createWorkflowCatalog([unionOutputCatalogItem]),
    }).issues.map((issue) => issue.code)).toContain("boundary.end-output-mismatch.schema");
  });

  test("rejects boundary schemas that ignore closed objects and scalar constraints", () => {
    const looseStringDocument = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.loose-string",
      nodes: [
        {
          catalogItemId: "testing.long-prompt",
          id: "long-prompt",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: promptJsonSchema,
          },
        },
        type: "manual",
      },
    });
    const extraClosedFieldDocument = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.extra-closed-field",
      nodes: [
        {
          catalogItemId: "testing.prompt-payload",
          id: "prompt-payload",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          request: {
            jsonSchema: {
              additionalProperties: false,
              properties: {
                extra: {
                  type: "string",
                },
                prompt: {
                  type: "string",
                },
              },
              required: ["prompt", "extra"],
              type: "object",
            },
          },
        },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(looseStringDocument, {
      catalog: createWorkflowCatalog([longPromptCatalogItem]),
    }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "node.input-schema",
    ]));
    expect(validateWorkflowDocument(extraClosedFieldDocument, {
      catalog: createWorkflowCatalog([promptPayloadCatalogItem]),
    }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "node.input-schema",
    ]));
  });

  test("validates literal strings against target format constraints", () => {
    const catalog = createWorkflowCatalog([emailCatalogItem]);
    const invalidEmailDocument = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.invalid-email-literal",
      nodes: [
        {
          catalogItemId: "testing.email",
          id: "email",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          email: {
            jsonSchema: {
              const: "not-an-email",
              type: "string",
            },
          },
        },
        type: "manual",
      },
    });
    const validEmailDocument = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.valid-email-literal",
      nodes: [
        {
          catalogItemId: "testing.email",
          id: "email",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          email: {
            jsonSchema: {
              const: "team@example.com",
              type: "string",
            },
          },
        },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(invalidEmailDocument, { catalog }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "node.input-schema",
    ]));
    expect(validateWorkflowDocument(validEmailDocument, { catalog })).toEqual({
      issues: [],
      ok: true,
    });
  });

  test("strictly validates date and date-time literal formats", () => {
    const dateCatalog = createWorkflowCatalog([formatCatalogItem("date")]);
    const dateTimeCatalog = createWorkflowCatalog([formatCatalogItem("date-time")]);
    const documentFor = (id: string, value: string, catalogItemId: string) => createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id,
      nodes: [
        {
          catalogItemId,
          id: "format",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          value: {
            jsonSchema: {
              const: value,
              type: "string",
            },
          },
        },
        type: "manual",
      },
    });

    expect(validateWorkflowDocument(documentFor("document.invalid-date", "2024-02-30", "testing.date"), {
      catalog: dateCatalog,
    }).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "boundary.trigger-input-mismatch.schema",
      "node.input-schema",
    ]));
    expect(validateWorkflowDocument(documentFor("document.valid-date", "2024-02-29", "testing.date"), {
      catalog: dateCatalog,
    })).toEqual({
      issues: [],
      ok: true,
    });
    expect(validateWorkflowDocument(documentFor("document.invalid-date-time-date", "2024-02-30T10:00:00Z", "testing.date-time"), {
      catalog: dateTimeCatalog,
    }).ok).toBe(false);
    expect(validateWorkflowDocument(documentFor("document.invalid-date-time-shape", "March 1, 2024", "testing.date-time"), {
      catalog: dateTimeCatalog,
    }).ok).toBe(false);
    expect(validateWorkflowDocument(documentFor("document.valid-date-time", "2024-02-29T10:00:00Z", "testing.date-time"), {
      catalog: dateTimeCatalog,
    })).toEqual({
      issues: [],
      ok: true,
    });
  });

  test("validates intermediate node inputs before compile", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem, payloadCatalogItem]);
    const document = createWorkflowDocument({
      end: {
        id: "done",
        output: {
          result: {
            jsonSchema: textJsonSchema,
          },
        },
      },
      id: "document.impossible-chain",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "echo",
        },
        {
          catalogItemId: "testing.payload",
          id: "payload",
        },
      ],
      trigger: {
        id: "prompt",
        input: {
          prompt: {
            jsonSchema: promptJsonSchema,
          },
        },
        type: "manual",
      },
    });

    const validation = validateWorkflowDocument(document, { catalog });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("node.input-unavailable");
    expect(() => compileWorkflowDocument({ catalog, document })).toThrow(/requires input payload/);
  });

  test("edits step order from authored edges instead of stale node array order", () => {
    const document = createWorkflowDocument({
      edges: [
        {
          id: "prompt->second",
          source: "prompt",
          target: "second",
        },
        {
          id: "second->first",
          source: "second",
          target: "first",
        },
        {
          id: "first->done",
          source: "first",
          target: "done",
        },
      ],
      end: {
        id: "done",
      },
      id: "document.edge-order",
      nodes: [
        {
          catalogItemId: "testing.echo",
          id: "first",
        },
        {
          catalogItemId: "testing.echo",
          id: "second",
        },
      ],
      trigger: {
        id: "prompt",
        type: "manual",
      },
    });

    const inserted = workflowEditor.addStep(document, {
      catalogItemId: "testing.echo",
      id: "inserted",
    }, {
      after: "second",
    });
    expect(inserted.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["prompt", "second"],
      ["second", "inserted"],
      ["inserted", "first"],
      ["first", "done"],
    ]);

    const moved = workflowEditor.moveStep(document, {
      before: "second",
      stepId: "first",
    });
    expect(moved.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["prompt", "first"],
      ["first", "second"],
      ["second", "done"],
    ]);
  });

  test("validates trigger-specific config in workflow documents", () => {
    const invalid = workflowDocumentSchema.safeParse({
      edges: [],
      end: {
        id: "done",
      },
      id: "document.invalid-trigger",
      nodes: [],
      trigger: {
        id: "block",
        type: "block",
      },
    });

    expect(invalid.success).toBe(false);
  });

  test("reports document validation errors before compile", () => {
    const catalog = createWorkflowCatalog([echoCatalogItem]);
    const document = workflowEditor.connect(createWorkflowDocument({
      end: {
        id: "done",
      },
      id: "document.invalid",
      nodes: [
        {
          catalogItemId: "missing.item",
          id: "missing",
        },
      ],
      trigger: {
        id: "prompt",
        type: "manual",
      },
    }), {
      source: "missing",
      target: "ghost",
    });

    const validation = validateWorkflowDocument(document, { catalog });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "edge.target",
      "catalog.missing-item",
    ]));
  });

  test("keeps code-first trigger and end helpers small", () => {
    expect(trigger.schedule({
      config: {
        cron: "0 9 * * *",
        timezone: "Europe/London",
      },
      id: "morning",
    })).toMatchObject({
      boundary: "trigger",
      config: {
        cron: "0 9 * * *",
        timezone: "Europe/London",
      },
      id: "morning",
      type: "schedule",
    });
    expect(end.result({
      id: "ready",
      label: "Ready",
    })).toMatchObject({
      boundary: "end",
      id: "ready",
      label: "Ready",
      type: "result",
    });
  });

  test("dogfoods catalog resolution as a workflow step", async () => {
    const app = loop({
      id: "catalog.resolve-node",
      steps: [
        createResolveWorkflowNodeStep({
          catalog: createWorkflowCatalog([echoCatalogItem]),
        }),
      ],
    });

    const session = await app.start({
      need: {
        inputKeys: ["prompt"],
        intent: "echo this prompt into a result",
        verbs: ["echo"],
      },
    });

    expect(session.status).toBe("completed");
    expect(session.state.nodeResolution).toMatchObject({
      catalogItemId: "testing.echo",
      decision: "use-catalog",
    });
  });

  test("uses custom end ids for workflow app end hook traces", async () => {
    const workflow = compileWorkflowDocument({
      catalog: createWorkflowCatalog([echoCatalogItem]),
      document: createWorkflowDocument({
        end: {
          id: "result-ready",
          output: {
            result: {
              jsonSchema: textJsonSchema,
            },
          },
        },
        id: "document.end-trace",
        nodes: [
          {
            catalogItemId: "testing.echo",
            id: "echo",
          },
        ],
        trigger: {
          id: "prompt",
          input: {
            prompt: {
              jsonSchema: promptJsonSchema,
            },
          },
          type: "manual",
        },
      }),
    });
    const app = createWorkflowApp({
      defaultWorkflow: "echo",
      workflows: {
        echo: {
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app, {
      endHooks: [() => []],
    });

    const run = await runtime.startRun({
      input: "ship",
      workflowId: "echo",
    });
    const endStarted = run.events.find((event) => event.type === "workflow.end.started");

    expect(endStarted).toMatchObject({
      stepId: "result-ready",
    });
    expect(endStarted?.trace).toMatchObject({
      name: "result-ready",
      spanId: "step:result-ready:attempt:1",
    });
  });
});
