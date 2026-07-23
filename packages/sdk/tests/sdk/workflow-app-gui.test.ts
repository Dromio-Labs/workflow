import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  createWorkflowApp,
  createWorkflowGuiPayload,
  runWorkflowAppGui,
} from "@dromio/workflow/app";
import {
  ask,
  createRuntimeStep,
  done,
  loop,
} from "@dromio/workflow/core";

describe("workflow app GUI", () => {
  test("projects a workflow app into a browser canvas payload", () => {
    const app = fixtureApp();
    const payload = createWorkflowGuiPayload(app);

    expect(payload).toMatchObject({
      appId: "gui-test",
      defaultWorkflowId: "inspect",
      title: "GUI Test",
    });
    expect(payload.workflows[0]?.model.nodes.map((node) => node.id)).toEqual([
      "$initial",
      "$trigger",
      "inspect",
      "$end",
    ]);
    expect(payload.workflows[0]?.layout.boxes).toHaveLength(4);
    expect(payload.workflows[0]?.trigger).toEqual({
      id: "$trigger",
      input: { kind: "none", required: false },
      label: "Trigger",
      type: "manual",
    });
  });

  test("serves the ChatShell canvas, runtime modules, and workflow payload", async () => {
    const server = runWorkflowAppGui(fixtureApp(), {
      defaultInput: "inspect by default",
      port: 0,
      stdout: { write() {} },
    });

    try {
      const [page, styles, shellScript, script, activityScript, canvasEdgesScript, controlsScript, jsonScript, runtimeScript, payload, missing] = await Promise.all([
        fetch(server.url),
        fetch(`${server.url}/app.css`),
        fetch(`${server.url}/shell.js`),
        fetch(`${server.url}/app.js`),
        fetch(`${server.url}/activity.js`),
        fetch(`${server.url}/canvas-edges.js`),
        fetch(`${server.url}/controls.js`),
        fetch(`${server.url}/json.js`),
        fetch(`${server.url}/runtime.js`),
        fetch(`${server.url}/api/workflows`),
        fetch(`${server.url}/missing`),
      ]);

      expect(page.headers.get("content-type")).toContain("text/html");
      const pageBody = await page.text();
      expect(pageBody).toContain('data-workflow-gui="gui-test"');
      expect(pageBody).toContain('id="workflow-gui-root"');
      expect(pageBody).toContain('src="/shell.js"');
      expect(pageBody).not.toContain('id="new-run"');
      expect(pageBody).not.toContain("window-controls");
      const css = await styles.text();
      expect(css).toContain("--color-brand: #00a5ef");
      expect(css).toContain("@keyframes edge-flow");
      expect(css).toContain("@keyframes activity-text-shimmer");
      expect(css).toContain('.activity-item[open] > .activity-summary .activity-chevron');
      expect(css).toContain(".run-dock[hidden]");
      expect(css).toContain(".activity-side-panel");
      expect(css).toContain(".node-detail-card");
      expect(css).toContain(".workflow-initial-state");
      expect(css).toContain(".artifact-drop-zone");
      expect(css).toContain(".question-fieldset");
      expect(css).toContain("#question-custom:focus-visible");
      expect(css).toContain("height: 29px");
      expect(css).toContain("button:disabled");
      expect(css).toContain('.activity-toggle-button[aria-pressed="true"]');
      expect(css).toContain('.workflow-sidebar-item[aria-current="page"]');
      expect(css).toContain(".hero-sidebar-scroll-mask");
      const shellBody = await shellScript.text();
      expect(shellBody).toContain("workflow-sidebar-panel");
      expect(shellBody).toContain("workflow-sidebar-item");
      expect(shellBody).toContain("workflow-gui-select-workflow");
      expect(shellBody).toContain("Resize workflow activity");
      expect(shellBody).toContain('aria-pressed');
      expect(shellBody).not.toContain("<span>Activity</span>");
      expect(shellBody).toContain("node-detail-card hero-scrollbar");
      expect(shellBody).toContain("DataGroup");
      expect(shellBody).toContain("workflowGuiRenderTriggerForm");
      expect(shellBody).toContain("json-render-trigger-form");
      expect(shellBody).toContain("structured-run-form");
      expect(shellBody).toContain("artifact-drop-zone");
      expect(shellBody).toContain("question-fieldset");
      const scriptBody = await script.text();
      expect(scriptBody).toContain("renderCanvas");
      expect(scriptBody).toContain("followLatestActivity");
      expect(scriptBody).toContain("updateLiveActivityPreview");
      expect(scriptBody).toContain("renderNodeDetail");
      expect(scriptBody).toContain("renderStructuredTrigger");
      expect(scriptBody).toContain("renderArtifactTrigger");
      expect(scriptBody).toContain("syncStructuredRunSubmit");
      expect(scriptBody).toContain("structuredRunSubmit.disabled");
      expect(scriptBody).toContain("pollWaitingRun");
      expect(scriptBody).toContain('fetch(`/api/runs/${encodeURIComponent(run.runId)}`)');
      expect(scriptBody).toContain("questionKey === renderedQuestionKey");
      expect(scriptBody).toContain('setTerminalNodeStatus("trigger", "completed", currentTrigger().id)');
      expect(scriptBody).toContain('sourceKind === "trigger" && !sourceStatus');
      expect(scriptBody).toContain('event.target.closest?.(".node-detail-card")');
      expect(scriptBody).toContain('inspectableJson(parsed.value, "Workflow result")');
      const activityBody = await activityScript.text();
      expect(activityBody).toContain("renderWorkflowActivity");
      expect(activityBody).toContain("activityHierarchy");
      expect(activityBody).toContain("durationLabel");
      expect(await canvasEdgesScript.text()).toContain("renderCanvasEdges");
      const controlsBody = await controlsScript.text();
      expect(controlsBody).toContain("bindEnterSubmit");
      expect(controlsBody).toContain("bindSidebarToggle");
      const jsonBody = await jsonScript.text();
      expect(jsonBody).toContain("highlightedJson");
      expect(jsonBody).toContain("inspectableJson");
      expect(jsonBody).toContain("JSON display mode");
      expect(jsonBody).toContain("if (!details || details.open) activate()");
      expect(await runtimeScript.text()).toContain("streamWorkflowRequest");
      const guiPayload = await payload.json() as {
        workflows: Array<{ trigger: { input: { defaultValue?: string } } }>;
      };
      expect(guiPayload.workflows).toHaveLength(1);
      expect(guiPayload.workflows[0]?.trigger.input.defaultValue).toBeUndefined();
      expect(missing.status).toBe(404);
    } finally {
      server.stop();
    }
  });

  test("streams a manual trigger through completion", async () => {
    const server = runWorkflowAppGui(fixtureApp(), { port: 0, stdout: { write() {} } });
    try {
      const response = await fetch(`${server.url}/api/runs`, {
        body: JSON.stringify({ workflowId: "inspect" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const messages = await ndjson(response);
      expect(messages.some((message) => message.type === "event")).toBe(true);
      expect(messages.at(-1)).toMatchObject({ type: "run", run: { status: "completed" } });
    } finally {
      server.stop();
    }
  });

  test("requires input only when the workflow declares a prompt trigger", async () => {
    const server = runWorkflowAppGui(promptApp(), { port: 0, stdout: { write() {} } });
    try {
      const response = await fetch(`${server.url}/api/runs`, {
        body: JSON.stringify({ workflowId: "prompt" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Input is required for Prompt workflow." });
    } finally {
      server.stop();
    }
  });

  test("carries shared structured and artifact trigger descriptors into the GUI", () => {
    const payload = createWorkflowGuiPayload(structuredInputApp());

    expect(payload.workflows.map((workflow) => workflow.trigger.input)).toMatchObject([
      {
        document: { component: "QuestionForm" },
        kind: "json-render",
        required: true,
      },
      {
        accept: ["image/png", "application/pdf"],
        kind: "artifact",
        multiple: true,
        required: true,
      },
    ]);
  });

  test("encodes structured input and preserves artifact metadata on a run", async () => {
    const server = runWorkflowAppGui(structuredInputApp(), { port: 0, stdout: { write() {} } });
    try {
      const structured = await ndjson(await fetch(`${server.url}/api/runs`, {
        body: JSON.stringify({ input: { topic: "workflow traces" }, workflowId: "structured" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }));
      expect(structured.at(-1)).toMatchObject({
        run: { input: '{"topic":"workflow traces"}' },
        type: "run",
      });

      const artifact = await ndjson(await fetch(`${server.url}/api/runs`, {
        body: JSON.stringify({
          attachments: [{ label: "attachment-1", mediaType: "image/png", name: "trace.png", size: 42 }],
          input: { artifacts: [{ name: "trace.png" }] },
          workflowId: "artifact",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }));
      expect(artifact.at(-1)).toMatchObject({
        run: {
          attachments: [{ mediaType: "image/png", name: "trace.png", size: 42 }],
          input: '{"artifacts":[{"name":"trace.png"}]}',
        },
      });
    } finally {
      server.stop();
    }
  });

  test("uploads artifact bytes before starting an artifact workflow", async () => {
    const server = runWorkflowAppGui(structuredInputApp(), { port: 0, stdout: { write() {} } });
    try {
      const form = new FormData();
      form.set("file", new File(["workflow trace"], "trace.pdf", { type: "application/pdf" }));
      form.set("label", "attachment-1");
      form.set("workflowId", "artifact");
      const response = await fetch(`${server.url}/api/artifacts`, { body: form, method: "POST" });
      const attachment = await response.json() as { path: string; size: number };

      expect(response.ok).toBe(true);
      expect(attachment.size).toBe(14);
      expect(existsSync(attachment.path)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("answers a suspended question and resumes the same run", async () => {
    const server = runWorkflowAppGui(questionApp(), { port: 0, stdout: { write() {} } });
    try {
      const started = await ndjson(await fetch(`${server.url}/api/runs`, {
        body: JSON.stringify({ input: "review", workflowId: "question" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }));
      const waiting = started.at(-1)?.run as { pendingQuestions: Array<{ id: string }>; runId: string; status: string };
      expect(waiting.status).toBe("waiting");

      const resumed = await ndjson(await fetch(
        `${server.url}/api/runs/${waiting.runId}/questions/${waiting.pendingQuestions[0]!.id}`,
        {
          body: JSON.stringify({ value: "complete" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ));
      expect(resumed.at(-1)).toMatchObject({ type: "run", run: { status: "completed" } });
    } finally {
      server.stop();
    }
  });
});

function fixtureApp() {
  const workflow = loop({
    id: "inspect-workflow",
    steps: [createRuntimeStep("inspect", () => done())],
  });
  return createWorkflowApp({
    defaultWorkflow: "inspect",
    id: "gui-test",
    title: "GUI Test",
    workflows: {
      inspect: {
        title: "Inspect workflow",
        workflow,
      },
    },
  });
}

function questionApp() {
  const workflow = loop({
    id: "question-workflow",
    steps: [createRuntimeStep("question", (context) => {
      if ("scope" in context.answers) return done({ scope: context.answers.scope });
      return ask({
        id: "scope",
        options: [{ label: "Complete", value: "complete" }],
        prompt: "Which scope?",
        type: "choice",
      });
    })],
  });
  return createWorkflowApp({
    defaultWorkflow: "question",
    id: "gui-question-test",
    workflows: { question: { workflow } },
  });
}

function promptApp() {
  const workflow = loop({
    id: "prompt-workflow",
    steps: [createRuntimeStep("prompt", () => done())],
  });
  return createWorkflowApp({
    defaultWorkflow: "prompt",
    id: "gui-prompt-test",
    workflows: {
      prompt: {
        input: { kind: "prompt" },
        title: "Prompt workflow",
        workflow,
      },
    },
  });
}

function structuredInputApp() {
  const workflow = loop({
    id: "structured-workflow",
    steps: [createRuntimeStep("process", () => done())],
  });
  return createWorkflowApp({
    defaultWorkflow: "structured",
    id: "gui-structured-test",
    workflows: {
      structured: {
        input: {
          document: {
            component: "QuestionForm",
            props: {
              fields: [{ label: "Topic", name: "topic", required: true, type: "text" }],
              question: "What should this workflow inspect?",
            },
          },
          kind: "json-render",
        },
        workflow,
      },
      artifact: {
        input: {
          accept: ["image/png", "application/pdf"],
          kind: "artifact",
          multiple: true,
        },
        workflow,
      },
    },
  });
}

async function ndjson(response: Response) {
  expect(response.ok).toBe(true);
  return (await response.text()).trim().split("\n").map((line) => JSON.parse(line)) as Array<{
    run?: Record<string, unknown>;
    type: string;
  }>;
}
