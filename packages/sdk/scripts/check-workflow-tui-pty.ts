const previousDebug = process.env.DEBUG;
delete process.env.DEBUG;

await import("@opentui/solid/preload");

import * as path from "node:path";

const root = import.meta.dir.endsWith("/scripts") ? path.resolve(import.meta.dir, "..") : process.cwd();
const { testRender } = await import("@opentui/solid");
const { done, loop, createRuntimeStep } = await import(path.join(root, "src/sdk/core/index.ts"));
const { createWorkflowApp, createWorkflowAppRuntime } = await import(path.join(root, "src/sdk/client/index.ts"));
const { WorkflowAppTuiShell } = await import(path.join(root, "src/sdk/client/interactions/workflow-app-tui.impl.tsx"));

const planner = loop({
  id: "pty.planner",
  steps: [
    createRuntimeStep("planner-finish", (context: { input: unknown }) => done({ input: context.input }), {
      label: "Planner Step",
    }),
  ],
});

const app = createWorkflowApp({
  defaultWorkflow: "planner",
  title: "PTY Smoke",
  workflows: {
    planner: {
      result: {
        format(session: { state: Record<string, { input?: unknown }> }) {
          const state = session.state;
          return "Input: " + String(state["planner-finish"]?.input ?? "");
        },
      },
      title: "Planner",
      workflow: planner,
    },
  },
});

const runtime = createWorkflowAppRuntime(app);
const view = await testRender(() => WorkflowAppTuiShell({
  app,
  defaultPrompt: "ship",
  onExit() {},
  runtime,
}), {
  height: 30,
  width: 100,
});

await view.renderOnce();
let frame = view.captureCharFrame();
assertIncludes(frame, "Planner Step", "initial Planner screen");

view.mockInput.pressArrow("down");
await view.renderOnce();
frame = view.captureCharFrame();
assertMatches(frame, /> +\[start\] Trigger/, "down arrow kept workflow step selection stable");
assertNotMatches(frame, /> +01 Planner Step/, "down arrow did not switch steps while the prompt is focused");

view.mockInput.pressTab();
view.mockInput.pressArrow("down");
await view.renderOnce();
frame = view.captureCharFrame();
assertMatches(frame, /> +01 Planner Step/, "tab selected Planner Step");

view.mockInput.pressTab();
await view.renderOnce();
view.mockInput.pressCtrlC();
await view.renderOnce();
for (const char of "draft") view.mockInput.pressKey(char);
await view.renderOnce();
frame = view.captureCharFrame();
assertIncludes(frame, "> draft", "prompt accepted text after Ctrl+C");
assertExcludes(frame, "> shipdraft", "Ctrl+C cleared the default prompt");
assertExcludes(frame, "Filter workflows > draft", "Ctrl+C stayed on the start prompt");

view.mockInput.pressEnter();
await waitFor(() => runtime.listRuns()[0]?.status === "completed");
await view.renderOnce();

const run = runtime.listRuns()[0];
if (!run) throw new Error("No run was recorded.");
const formatted = runtime.formatResult(run.runId);
if (formatted.includes("shipdraft")) {
  throw new Error("Ctrl+C did not clear the submitted prompt before running.");
}
assertIncludes(formatted, "draft", "submitted prompt reached the workflow");

view.renderer.destroy();
if (previousDebug === undefined) {
  delete process.env.DEBUG;
} else {
  process.env.DEBUG = previousDebug;
}

console.log("TUI smoke passed: prompt focus stayed stable, Tab selected steps, Ctrl+C kept the prompt alive, Enter ran the workflow.");

function assertIncludes(value: string, expected: string, label: string) {
  if (!value.includes(expected)) {
    throw new Error(label + ": expected output to include " + JSON.stringify(expected) + ".");
  }
}

function assertExcludes(value: string, unexpected: string, label: string) {
  if (value.includes(unexpected)) {
    throw new Error(label + ": expected output not to include " + JSON.stringify(unexpected) + ".");
  }
}

function assertMatches(value: string, expected: RegExp, label: string) {
  if (!expected.test(value)) {
    throw new Error(label + ": expected output to match " + String(expected) + ".");
  }
}

function assertNotMatches(value: string, unexpected: RegExp, label: string) {
  if (unexpected.test(value)) {
    throw new Error(label + ": expected output not to match " + String(unexpected) + ".");
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for workflow run to complete.");
}
