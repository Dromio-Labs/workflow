import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  computeWorkflowRenderLayout,
  createWorkflowJsonRenderRegistry,
  inspectWorkflowJsonRenderDocument,
  listWorkflowJsonRenderComponents,
  projectWorkflowDocumentRenderModel,
  projectWorkflowGraphRenderModel,
  renderWorkflowJsonRenderDocument,
  renderWorkflowModelToMermaid,
  validateWorkflowViewRendererAdapterSnapshot,
  workflowMermaidRenderer,
  workflowRenderLayoutProfiles,
  workflowRenderExamples,
  workflowViewRendererAdapterSnapshotIsRenderable,
  validateWorkflowRenderability,
  type WorkflowRenderModel,
  type WorkflowViewCommand,
} from "@dromio/workflow/client";
import {
  WorkflowCanvas,
  WorkflowCanvasPreview,
  WorkflowJsonRenderDocumentPreview,
  WorkflowJsonRenderFrame,
  WorkflowViewSnapshotPreview,
  workflowCanvasPreviewLayout,
  workflowCanvasPreviewExample,
  workflowReactCanvasAdapter,
  workflowReactPreviewAdapter,
} from "@dromio/workflow/react";
import {
  processImagesViewSnapshot,
} from "@dromio/workflow-room-protocol";
import {
  validateWorkbenchTuiWorkflowViewSnapshot,
  workbenchTuiWorkflowRendererAdapterContract,
  workflowViewProtocolFixtureSnapshot,
  workflowViewProtocolLines,
} from "@dromio/workflow/client/workflow-tui-test-surface";
import type {
  LoopGraphProjection,
} from "@dromio/workflow/core";

describe("workflow render model", () => {
  test("projects a graph into a renderable workflow model", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: graphFixture(),
      selectedNodeId: "draft",
      statuses: {
        draft: "running",
      },
    });

    expect(model).toMatchObject({
      id: "plan-review",
      label: "Plan Review",
      selectedNodeId: "draft",
      warnings: [],
    });
    expect(model.nodes.map((node) => [node.id, node.kind, node.status])).toEqual([
      ["$initial", "initial", undefined],
      ["prompt", "trigger", undefined],
      ["draft", "step", "running"],
      ["done", "end", undefined],
    ]);
    expect(model.nodes.map((node) => node.semantic.role)).toEqual([
      "boundary",
      "trigger",
      "action",
      "terminal",
    ]);
    expect(validateWorkflowRenderability(model)).toEqual({
      issues: [],
      ok: true,
    });
  });

  test("projects typed interaction waits and terminal outcomes without renderer inference", () => {
    const graph = graphFixture();
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      catalog: {
        id: "review.approval",
        kind: "approval",
        label: "Approve plan",
      },
    };
    const waiting = projectWorkflowGraphRenderModel({
      graph,
      interactions: [{ kind: "approval", state: "waiting", stepId: "draft" }],
      statuses: { draft: "waiting" },
      terminalOutcome: "cancelled",
    });

    expect(waiting.nodes.find((node) => node.id === "draft")?.semantic).toEqual({
      interactionKind: "approval",
      role: "interaction",
      state: "waiting",
    });
    expect(waiting.nodes.at(-1)?.semantic).toEqual({
      outcome: "cancelled",
      role: "terminal",
    });
  });

  test("synthesizes render boundaries for code-first graphs without explicit trigger or end nodes", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: {
        edges: [],
        id: "quick-review",
        label: undefined as unknown as string,
        nodes: [{
          id: "review",
          kind: "step",
          label: "Review",
          maxRetries: 0,
        }],
      },
    });
    const validation = validateWorkflowRenderability(model);

    expect(model.label).toBe("Quick Review");
    expect(model.nodes.map((node) => [node.id, node.kind])).toEqual([
      ["$initial", "initial"],
      ["$trigger", "trigger"],
      ["review", "step"],
      ["$end", "end"],
    ]);
    expect(model.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["$initial", "$trigger"],
      ["$trigger", "review"],
      ["review", "$end"],
    ]);
    expect(validation.ok).toBe(true);
  });

  test("projects forked child workflows with renderable trigger and end boundaries", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: {
        edges: [],
        id: "review",
        label: "Review",
        nodes: [{
          catalog: {
            execution: {
              branches: [
                { childWorkflowDocumentId: "assess-response", id: "assess", label: "Assess" },
                { childWorkflowDocumentId: "write-note", id: "write", label: "Write" },
              ],
              joinPolicy: "all",
              kind: "fork",
              label: "Review fork",
            },
            id: "review.fork",
            label: "Review fork",
          },
          childNodes: [
            { branch: { id: "assess" }, id: "assess-response", label: "Assess response" },
            { branch: { id: "write" }, id: "write-note", label: "Write note" },
          ],
          id: "review-response",
          kind: "step",
          label: "Review response",
          maxRetries: 0,
        }],
      },
    });
    const child = model.nodes.find((node) => node.id === "review-response")?.childWorkflow?.model;

    expect(child?.nodes.map((node) => [node.id, node.kind])).toEqual([
      ["review-response.fork:initial", "initial"],
      ["review-response.fork:trigger", "trigger"],
      ["assess-response", "step"],
      ["write-note", "step"],
      ["review-response.fork:end", "end"],
    ]);
    expect(child?.edges.map((edge) => [edge.source, edge.target, edge.metadata.kind])).toEqual([
      ["review-response.fork:initial", "review-response.fork:trigger", "sequence"],
      ["review-response.fork:trigger", "assess-response", "fork"],
      ["assess-response", "review-response.fork:end", "join"],
      ["review-response.fork:trigger", "write-note", "fork"],
      ["write-note", "review-response.fork:end", "join"],
    ]);
    expect(child?.nodes.at(-1)?.semantic).toEqual({ policy: "all", role: "join" });
    expect(child?.edges.filter((edge) => edge.semantic.role === "branch").map((edge) => edge.label))
      .toEqual(["assess", "write"]);
    expect(validateWorkflowRenderability(model)).toEqual({ issues: [], ok: true });
  });

  test("projects coordinate-free workflow documents into deterministic layout", () => {
    const model = projectWorkflowDocumentRenderModel({
      document: {
        edges: [
          { id: "prompt->echo", source: "prompt", target: "echo" },
          { id: "echo->done", source: "echo", target: "done" },
        ],
        end: { id: "done", label: "Done" },
        id: "echo",
        nodes: [{ catalogItemId: "testing.echo", id: "echo", label: "Echo" }],
        trigger: { id: "prompt", label: "Prompt" },
      },
    });

    expect(model.warnings).toEqual([]);
    expect(computeWorkflowRenderLayout(model).boxes.map((box) => box.id)).toEqual([
      "echo:initial",
      "prompt",
      "echo",
      "done",
    ]);
    expect(validateWorkflowRenderability(model).ok).toBe(true);
  });

  test("reports renderability failures with stable codes", () => {
    const validation = validateWorkflowRenderability(invalidRenderModel());
    const codes = validation.issues.map((issue) => issue.code);

    expect(validation.ok).toBe(false);
    for (const code of [
      "RENDER_DUPLICATE_NODE_ID",
      "RENDER_EDGE_SOURCE_MISSING",
      "RENDER_EDGE_TARGET_MISSING",
      "RENDER_NODE_ID_MISSING",
      "RENDER_NODE_KIND_MISSING",
      "RENDER_NODE_KIND_INVALID",
      "RENDER_NODE_LABEL_MISSING",
      "RENDER_PORT_INVALID",
      "RENDER_SELECTED_NODE_MISSING",
    ] as const) {
      expect(codes).toContain(code);
    }
  });

  test("exposes json-render inspection helpers through the SDK render surface", () => {
    const inspection = inspectWorkflowJsonRenderDocument({
      component: "ImageBatchSummary",
      props: {
        imageCount: 42,
        pendingApproval: true,
        workflowId: "process-images",
      },
    });

    expect(inspection.component).toBe("ImageBatchSummary");
    expect(inspection.validation.ok).toBe(true);
    expect(listWorkflowJsonRenderComponents().map((component) => component.name)).toContain("ApprovalCard");
    expect(renderWorkflowJsonRenderDocument(createWorkflowJsonRenderRegistry({
      renderers: {
        ImageBatchSummary: ({ props }) => `${props.imageCount} images`,
      },
    }), inspection.document)).toMatchObject({
      ok: true,
      output: "42 images",
    });
    expect(inspection.schema.catalog).toBe("dromio.workflow-view.v1");
    expect(inspection.modes.map((mode) => mode.label)).toEqual([
      "Rendered component",
      "Component JSON",
      "Schema",
    ]);
  });

  test("exposes renderer adapter conformance through the SDK render surface", () => {
    const validation = validateWorkflowViewRendererAdapterSnapshot(
      workbenchTuiWorkflowRendererAdapterContract,
      processImagesViewSnapshot,
    );

    expect(validation.ok).toBe(true);
    expect(validateWorkbenchTuiWorkflowViewSnapshot(processImagesViewSnapshot).ok).toBe(true);
    expect(workflowViewRendererAdapterSnapshotIsRenderable(
      workbenchTuiWorkflowRendererAdapterContract,
      processImagesViewSnapshot,
    )).toBe(true);
  });

  test("renders terminal workflow room JSON Render inspection modes behind settings", () => {
    const renderSnapshot = workflowViewProtocolFixtureSnapshot({ fixture: "process-images" }) ?? processImagesViewSnapshot;
    const renderLines = workflowViewProtocolLines(renderSnapshot);
    const jsonLines = workflowViewProtocolLines(processImagesViewSnapshot, { mode: "json" });
    const schemaLines = workflowViewProtocolLines(processImagesViewSnapshot, { mode: "schema" });

    const renderText = renderLines.map((line) => line.text).join("\n");
    expect(renderText).toContain("┌─ Human input");
    expect(renderText).toContain("1 pending");
    expect(renderText).toContain("Approve image batch");
    expect(renderText).toContain("[42 images] [Manual approval]");
    expect(renderText).toContain("[ Approve batch ] [ Hold ]");
    expect(renderText).toContain("┌─ Response");
    expect(renderText).toContain("1 recorded");
    expect(renderText).toContain("✓ Response recorded");
    expect(renderText).toContain("Saved for this run");
    expect(renderText).toContain("Image batch summary");
    expect(renderText).toContain("||||||||||||....");
    expect(renderText).not.toContain("ApprovalCard");
    expect(renderText).not.toContain("Component JSON");
    expect(renderText).not.toContain("Component schema");
    expect(renderText).not.toContain('"component"');
    expect(renderText).not.toContain('"catalog"');
    expect(renderText).not.toContain("JSON/schema hidden");
    expect(renderText).not.toContain("workflow-view/v1");
    expect(renderText).not.toContain("process-batch · approval");
    expect(renderText).not.toContain("Step:");
    expect(jsonLines.map((line) => line.text).join("\n")).toContain("Component JSON");
    expect(jsonLines.map((line) => line.text).join("\n")).toContain('"component": "ApprovalCard"');
    expect(schemaLines.map((line) => line.text).join("\n")).toContain("Component schema");
    expect(schemaLines.map((line) => line.text).join("\n")).toContain('"catalog": "dromio.workflow-view.v1"');
  });

  test("computes adapter-neutral layout boxes for child workflows and loops", () => {
    const model = workflowRenderExamples.childWorkflow().model;
    const layout = computeWorkflowRenderLayout(model, workflowRenderLayoutProfiles.web);
    const childGroup = layout.boxes.find((box) => box.kind === "child-group");
    const loopGroup = layout.boxes.find((box) => box.kind === "loop-group");
    const childNode = layout.boxes.find((box) => box.id.includes(":child:") && box.kind === "step");

    expect(childGroup).toMatchObject({
      childWorkflowId: "child-review-workflow",
      kind: "child-group",
    });
    expect(loopGroup).toMatchObject({
      kind: "loop-group",
      parentId: childGroup?.id,
    });
    expect(childNode?.parentId).toBe(childGroup?.id);
    expect(childNode && childGroup).toBeTruthy();
    expect(childNode!.x).toBeGreaterThanOrEqual(childGroup!.x);
    expect(childNode!.y).toBeGreaterThanOrEqual(childGroup!.y);
    expect(layout.edges.some((edge) => edge.kind === "loop")).toBe(true);
  });

  test("lints computed layout geometry with adapter profiles", () => {
    const model = projectWorkflowGraphRenderModel({ graph: graphFixture() });
    const crampedProfile = {
      ...workflowRenderLayoutProfiles.web,
      gap: { x: -200, y: -200 },
    };
    const validation = validateWorkflowRenderability(model, {
      layoutProfile: crampedProfile,
      viewport: { height: 120, width: 120 },
    });
    const issues = validation.issues.map((issue) => [issue.code, issue.severity]);

    expect(issues).toContainEqual(["RENDER_NODE_OVERLAP", "error"]);
    expect(issues).toContainEqual(["RENDER_LAYOUT_VIEWPORT_EXCEEDED", "warning"]);
    expect(validation.ok).toBe(false);
  });

  test("renders the default React workflow preview", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: graphFixture(),
      selectedNodeId: "draft",
    });
    const html = renderToStaticMarkup(createElement(WorkflowCanvasPreview, {
      model,
    }));
    const adapterHtml = renderToStaticMarkup(workflowReactPreviewAdapter.render(model));

    expect(html).toContain('data-dromio-workflow-preview="plan-review"');
    expect(html).toContain("Draft plan");
    expect(html).toContain("Done");
    expect(html).toContain("<path");
    expect(adapterHtml).toContain("Plan prompt");
  });

  test("renders the full interactive React workflow canvas", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: graphFixture(),
      selectedNodeId: "draft",
      statuses: { draft: "running" },
    });
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { model }));
    const adapterHtml = renderToStaticMarkup(workflowReactCanvasAdapter.render(model));

    expect(html).toContain('data-dromio-workflow-canvas="plan-review"');
    expect(html).toContain('aria-roledescription="interactive workflow canvas"');
    expect(html).toContain('aria-label="Workflow canvas controls"');
    expect(html).toContain('data-node-status="running"');
    expect(html).toContain('aria-label="Selected workflow step"');
    expect(html).toContain("Drag to pan");
    expect(adapterHtml).toContain("Fit");
  });

  test("renders a full React workflow view snapshot with hooks and json-render result", () => {
    const commands: unknown[] = [];
    const html = renderToStaticMarkup(createElement(WorkflowViewSnapshotPreview, {
      onCommand(command) {
        commands.push(command);
      },
      snapshot: processImagesViewSnapshot,
    }));

    expect(html).toContain('data-dromio-workflow-view-snapshot="process-images"');
    expect(html).toContain('data-dromio-workflow-hooks="1"');
    expect(html).toContain('data-dromio-workflow-result="json-render"');
    expect(html).toContain('data-dromio-workflow-json-render-component="ApprovalCard"');
    expect(html).toContain('data-dromio-workflow-json-render-component="ImageBatchSummary"');
    expect(html).toContain("data-dromio-workflow-json-render-settings");
    expect(html).toContain("JSON Render display settings");
    expect(html).toContain('data-dromio-workflow-json-render-mode="render"');
    expect(html).not.toContain("Component JSON");
    expect(html).not.toContain('data-dromio-workflow-json-render-json');
    expect(html).not.toContain('data-dromio-workflow-json-render-schema');
    expect(html).toContain("Image count");
    expect(html).toContain("42");
    expect(html).toContain("Approve image batch");
    expect(commands).toEqual([]);
  });

  test("emits canonical hook resume commands from the React workflow preview", async () => {
    const commands: WorkflowViewCommand[] = [];
    const preview = createElement(WorkflowViewSnapshotPreview, {
      onCommand(command) {
        commands.push(command);
      },
      snapshot: processImagesViewSnapshot,
    });
    const renderedPreview = await renderFunctionElement(preview);
    const hooksPreview = findFunctionElement(
      renderedPreview,
      "WorkflowHooksPreview",
    );
    const renderedHooks = await renderFunctionElement(hooksPreview);
    const approvalActions = findFunctionElement(renderedHooks, "ApprovalActions");
    const renderedActions = await renderFunctionElement(approvalActions);
    const approveButton = findButtonElement(renderedActions, "Approve batch");

    approveButton.props.onClick?.();

    expect(commands).toEqual([
      expect.objectContaining({
        runId: "run_process_images_001",
        source: {
          adapterId: "dromio-sdk-react-preview",
          surface: "react",
        },
        token: "hook_process_images_batch_001",
        type: "workflow.hook.resume",
        value: {
          approved: true,
        },
      }),
    ]);
  });

  test("keeps SDK JSON Render inspection behind explicit preview modes", () => {
    const document = {
      component: "ImageBatchSummary",
      props: {
        imageCount: 42,
        pendingApproval: true,
        workflowId: "process-images",
      },
    } as const;
    const renderHtml = renderToStaticMarkup(createElement(WorkflowJsonRenderFrame, {
      document,
      title: "Image batch summary",
    }));
    const jsonHtml = renderToStaticMarkup(createElement(WorkflowJsonRenderFrame, {
      document,
      initialMode: "json",
      title: "Image batch summary",
    }));
    const schemaHtml = renderToStaticMarkup(createElement(WorkflowJsonRenderFrame, {
      document,
      initialMode: "schema",
      title: "Image batch summary",
    }));
    const contentOnlyHtml = renderToStaticMarkup(createElement(WorkflowJsonRenderFrame, {
      chrome: "content-only",
      document,
      title: "Image batch summary",
    }));

    expect(renderHtml).toContain("JSON Render display settings");
    expect(renderHtml).toContain('data-dromio-workflow-json-render-mode="render"');
    expect(renderHtml).toContain("42");
    expect(renderHtml).not.toContain('data-dromio-workflow-json-render-json');
    expect(renderHtml).not.toContain('data-dromio-workflow-json-render-schema');
    expect(contentOnlyHtml).toContain('aria-label="Image batch summary"');
    expect(contentOnlyHtml).toContain("42");
    expect(contentOnlyHtml).not.toContain("JSON Render display settings");
    expect(contentOnlyHtml).not.toContain("<h3");

    expect(jsonHtml).toContain('data-dromio-workflow-json-render-mode="json"');
    expect(jsonHtml).toContain('data-dromio-workflow-json-render-json');
    expect(jsonHtml).toContain("&quot;component&quot;");
    expect(jsonHtml).toContain("ImageBatchSummary");

    expect(schemaHtml).toContain('data-dromio-workflow-json-render-mode="schema"');
    expect(schemaHtml).toContain('data-dromio-workflow-json-render-schema');
    expect(schemaHtml).toContain("dromio.workflow-view.v1");
    expect(schemaHtml).toContain("valid");
  });

  test("renders plain JSON workflow results through the JSON Render inspector", () => {
    const html = renderToStaticMarkup(createElement(WorkflowViewSnapshotPreview, {
      snapshot: {
        ...processImagesViewSnapshot,
        result: {
          kind: "json",
          title: "Workflow outputs",
          value: {
            imageCount: 42,
            ok: true,
          },
        },
      },
    }));

    expect(html).toContain('data-dromio-workflow-result="json"');
    expect(html).toContain('data-dromio-workflow-json-render-component="JsonInspector"');
    expect(html).toContain("Workflow outputs");
    expect(html).toContain("JSON Render display settings");
    expect(html).not.toContain("Component JSON");
  });

  test("renders MarkdownBlock documents with the shared chat-shell renderer", () => {
    const rendered = WorkflowJsonRenderDocumentPreview({
      document: {
        component: "MarkdownBlock",
        props: {
          value: "# Note checkpoint\n\n- Captured a completed turn.",
        },
      },
    });

    expect(isValidElement(rendered)).toBe(true);
    const card = rendered as ReactElement<{
      children: ReactElement<{ content: string }>;
      "data-dromio-workflow-json-render-card": string;
    }>;
    expect(card.props["data-dromio-workflow-json-render-card"]).toBe("MarkdownBlock");
    expect(card.props.children.props.content).toBe(
      "# Note checkpoint\n\n- Captured a completed turn.",
    );
  });

  test("renders workflow command results through the JSON Render command status card", () => {
    const html = renderToStaticMarkup(createElement(WorkflowViewSnapshotPreview, {
      snapshot: {
        ...processImagesViewSnapshot,
        commandResults: [
          {
            accepted: true,
            command: {
              runId: "run-process-images",
              token: "hook-token-1",
              type: "workflow.hook.resume",
              value: { approved: true },
            },
            dispatch: {
              mode: "runtime",
              runtimeResumed: true,
              status: "dispatched",
              targetId: "run-process-images",
            },
          },
        ],
      },
    }));

    expect(html).toContain('data-dromio-workflow-command-results="1"');
    expect(html).toContain('data-dromio-workflow-json-render-component="CommandStatus"');
    expect(html).toContain("workflow.hook.resume");
    expect(html).toContain("runtime resumed");
  });

  test("derives a top-down preview layout from topology", () => {
    const model = projectWorkflowDocumentRenderModel({
      document: {
        edges: [
          { id: "request->resolve", source: "request", target: "resolve" },
          { id: "resolve->done", source: "resolve", target: "done" },
        ],
        end: { id: "done", label: "Done" },
        id: "process-images",
        nodes: [
          {
            catalogItemId: "images.resolve-runtime-config",
            id: "resolve",
            label: "Resolve config",
          },
        ],
        trigger: { id: "request", label: "Process images request" },
      },
    });
    const layout = workflowCanvasPreviewLayout(model);

    expect(layout.nodes.map((node) => [node.id, node.layoutPosition])).toEqual([
      ["process-images:initial", { x: 288, y: 0 }],
      ["request", { x: 288, y: 132 }],
      ["resolve", { x: 288, y: 264 }],
      ["done", { x: 288, y: 396 }],
    ]);
  });

  test("renders a static Mermaid workflow adapter", () => {
    const model = projectWorkflowGraphRenderModel({
      graph: graphFixture(),
      statuses: {
        draft: "running",
      },
    });
    const mermaid = renderWorkflowModelToMermaid(model, {
      includeStatus: true,
    });
    const adapterMermaid = workflowMermaidRenderer.render(model);

    expect(workflowMermaidRenderer.id).toBe("sdk.mermaid.workflow");
    expect(workflowMermaidRenderer.target).toBe("mermaid");
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('n0["Initial state<br/>boundary"]:::kindInitial');
    expect(mermaid).toContain('n1["Plan prompt<br/>manual trigger, none input"]:::kindTrigger');
    expect(mermaid).toContain('n2["Draft plan<br/>action<br/>running"]:::kindStep');
    expect(mermaid).toContain("n0 --> n1");
    expect(adapterMermaid).toContain('n3["Done<br/>result terminal"]:::kindEnd');
  });

  test("exposes SDK render examples for first-party surfaces", () => {
    const starter = workflowRenderExamples.starterWorkbenchWorkflow();
    const running = workflowRenderExamples.runningWorkflow();
    const incomplete = workflowRenderExamples.incompleteLayout();
    const child = workflowRenderExamples.childWorkflow();
    const failure = workflowRenderExamples.validationFailure();
    const previewHtml = renderToStaticMarkup(workflowCanvasPreviewExample());

    expect(starter.validation.ok).toBe(true);
    expect(running.model.nodes.map((node) => [node.id, node.status])).toContainEqual(["review", "running"]);
    expect(incomplete.model.warnings).toEqual([]);
    expect(child.model.nodes).toContainEqual(expect.objectContaining({
      childWorkflowId: "child-review-workflow",
      childWorkflow: expect.objectContaining({
        model: expect.objectContaining({
          loops: [expect.objectContaining({ id: "review-repair-loop" })],
        }),
      }),
      kind: "workflow",
    }));
    expect(failure.validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "RENDER_EDGE_TARGET_MISSING",
        "RENDER_SELECTED_NODE_MISSING",
      ]),
    );
    expect(previewHtml).toContain('data-dromio-workflow-preview="starter-workbench-workflow"');
  });
});

type ReactTestElementProps = Record<string, unknown> & {
  children?: ReactNode;
};

type ReactTestButtonProps = ReactTestElementProps & {
  onClick?: () => void;
};

type ReactTestFunctionElement = ReactElement<ReactTestElementProps> & {
  type: (props: ReactTestElementProps) => Promise<ReactNode> | ReactNode;
};

async function renderFunctionElement(
  element: ReactElement<ReactTestElementProps>,
): Promise<ReactNode> {
  if (!isReactTestFunctionElement(element)) return element;
  return await Promise.resolve(element.type(element.props));
}

function isReactTestFunctionElement(
  element: ReactElement<ReactTestElementProps>,
): element is ReactTestFunctionElement {
  return typeof element.type === "function";
}

function findFunctionElement(
  node: ReactNode,
  functionName: string,
): ReactElement<ReactTestElementProps> {
  if (isValidElement<ReactTestElementProps>(node)) {
    if (typeof node.type === "function" && node.type.name === functionName) {
      return node;
    }
    for (const child of Children.toArray(node.props.children)) {
      try {
        return findFunctionElement(child, functionName);
      } catch (caught) {
        if (!(caught instanceof Error)) throw caught;
      }
    }
  }
  throw new Error(`React function element ${functionName} was not found.`);
}

function findButtonElement(
  node: ReactNode,
  label: string,
): ReactElement<ReactTestButtonProps> {
  if (isValidElement<ReactTestButtonProps>(node)) {
    if (node.type === "button" && reactText(node.props.children) === label) {
      return node;
    }
    for (const child of Children.toArray(node.props.children)) {
      try {
        return findButtonElement(child, label);
      } catch (caught) {
        if (!(caught instanceof Error)) throw caught;
      }
    }
  }
  throw new Error(`React button ${label} was not found.`);
}

function reactText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : ""
    )
    .join("");
}

function graphFixture(): LoopGraphProjection {
  return {
    edges: [
      { from: "prompt", id: "prompt->draft", kind: "sequence", to: "draft" },
      { from: "draft", id: "draft->done", kind: "sequence", to: "done" },
    ],
    end: {
      boundary: "end",
      id: "done",
      label: "Done",
    },
    id: "plan-review",
    label: "Plan Review",
    nodes: [
      {
        id: "draft",
        kind: "step",
        label: "Draft plan",
        maxRetries: 1,
      },
    ],
    trigger: {
      boundary: "trigger",
      id: "prompt",
      label: "Plan prompt",
      type: "manual",
    },
  };
}

function invalidRenderModel(): WorkflowRenderModel {
  return {
    edges: [
      { id: "missing-source", metadata: {}, semantic: { role: "sequence" }, source: "ghost", target: "first" },
      { id: "missing-target", metadata: {}, semantic: { role: "sequence" }, source: "first", target: "ghost" },
    ],
    id: "invalid",
    label: "Invalid",
    loops: [],
    nodes: [
      {
        id: "first",
        kind: "step",
        label: "First",
        metadata: {},
        ports: [{ id: "first:out", type: "source" }],
        semantic: { role: "action" },
      },
      {
        id: "first",
        kind: "step",
        label: "",
        metadata: {},
        ports: [{ id: "", type: "source" }],
        semantic: { role: "action" },
      },
      {
        id: "",
        kind: "missing" as never,
        label: "No id",
        metadata: {},
        ports: [],
        semantic: { role: "action" },
      },
      {
        id: "bad-kind",
        kind: "missing" as never,
        label: "Bad kind",
        metadata: {},
        ports: [],
        semantic: { role: "action" },
      },
      {
        id: "missing-kind",
        kind: undefined as never,
        label: "Missing kind",
        metadata: {},
        ports: [],
        semantic: { role: "action" },
      },
    ],
    readOnly: true,
    selectedNodeId: "selected-missing",
    warnings: [],
  };
}
