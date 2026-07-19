/**
 * Restart-survival demo: a run pauses on an approval, the process that
 * started it DIES, a brand-new process answers over HTTP and completes it.
 *
 *   bun scripts/demo-restart-survival.ts             orchestrate (two child processes)
 *   bun scripts/demo-restart-survival.ts phase-a DB  start run, park on approval, exit
 *   bun scripts/demo-restart-survival.ts phase-b DB  fresh harness, answer via HTTP, print receipt
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
} from "../src/sdk/client/index.js";
import { createHook, done, loop, createRuntimeStep } from "../src/sdk/core/index.js";
import {
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
  createWorkflowControlPlaneHttpAdapter,
} from "../src/sdk/workflow-control-plane/index.js";

const RUN_ID = "run_demo_restart";

function createDemoHarness(dbPath: string) {
  const approval = createHook<{ label: string }, string>({
    id: "approval",
    kind: "question",
  });
  const app = createWorkflowApp({
    defaultWorkflow: "escalate",
    id: "restart-demo",
    workflows: {
      escalate: {
        result: {
          format: (session: { state?: unknown }) =>
            JSON.stringify((session.state as Record<string, unknown>)?.finish ?? session.state),
        },
        workflow: loop<unknown, string>({
          id: "escalate",
          steps: [
            createRuntimeStep("prepare", () => done({ prepared: true })),
            createRuntimeStep("approve", async (context) => {
              const approved = await context.waitFor(approval, { label: "Send it?" });
              return done({ approved, prepared: context.state.prepared });
            }),
            createRuntimeStep("finish", (context) =>
              done({ approved: context.state.approved, prepared: context.state.prepared })),
          ],
        }),
      },
    },
  });
  const store = createSqliteWorkflowRuntimeStore(dbPath);
  const controlPlane = createWorkflowControlPlane({
    app,
    runtime: createWorkflowAppRuntime(app),
    runtimeStore: store,
    triggerStore: { async read() { return { triggers: [], version: 1 }; } },
  });
  return { controlPlane, http: createWorkflowControlPlaneHttpAdapter({ controlPlane }), store };
}

async function phaseA(dbPath: string) {
  const { controlPlane, store } = createDemoHarness(dbPath);
  const run = await controlPlane.startRun({
    input: "customer is blocked",
    runId: RUN_ID,
    workflowId: "escalate",
  });
  const stored = await store.getWorkflowRun(RUN_ID);
  console.log(`  run ${run.runId} started`);
  console.log(`  [ok] prepare`);
  console.log(`  [⏸] approve — waiting for a human ("${run.pendingHooks?.[0]?.id}")`);
  console.log(`  persisted status: ${stored?.status}`);
  console.log(`  process A exiting — the run now exists ONLY in ${path.basename(dbPath)}`);
}

async function phaseB(dbPath: string) {
  const { http, store } = createDemoHarness(dbPath);
  const before = await store.getWorkflowRun(RUN_ID);
  console.log(`  fresh process, same sqlite file`);
  console.log(`  found run ${RUN_ID}: status=${before?.status}, pending=${before?.pendingQuestions?.[0]?.id ?? before?.pendingHooks?.[0]?.id}`);
  const response = await http.fetch(new Request(
    `http://local/api/runs/${RUN_ID}/questions/approval/answer`,
    { body: JSON.stringify({ value: "approved" }), method: "POST" },
  ));
  const body = await response.json() as { run?: { status?: string; result?: string; events?: Array<{ index: number; type: string; stepId?: string }> } };
  const run = body.run;
  console.log(`  [✓] answered over HTTP (${response.status})`);
  console.log(`  [ok] finish`);
  console.log(`  run ${run?.status}: result=${run?.result}`);
  const events = run?.events ?? [];
  const contiguous = events.every((event, index) => event.index === index);
  const prepareCompletions = events.filter((e) => e.type === "step.completed" && e.stepId === "prepare").length;
  console.log(`  events: ${events.length}, contiguous indexes: ${contiguous}, prepare completed exactly once: ${prepareCompletions === 1}`);
  if (run?.status !== "completed" || !contiguous || prepareCompletions !== 1) {
    console.error("  DEMO FAILED");
    process.exit(1);
  }
}

async function orchestrate() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "dromio-restart-demo-")), "runtime.sqlite");
  console.log("— phase A: start a run, park it on an approval, then DIE —");
  const a = Bun.spawnSync(["bun", import.meta.path, "phase-a", dbPath], { stderr: "inherit", stdout: "inherit" });
  if (a.exitCode !== 0) process.exit(a.exitCode);
  console.log("\n— process A is dead. restart. —\n");
  console.log("— phase B: a NEW process answers the approval over HTTP —");
  const b = Bun.spawnSync(["bun", import.meta.path, "phase-b", dbPath], { stderr: "inherit", stdout: "inherit" });
  if (b.exitCode !== 0) process.exit(b.exitCode);
  console.log("\nrestart survival: PROVEN");
}

const [mode, dbPath] = process.argv.slice(2);
if (mode === "phase-a" && dbPath) await phaseA(dbPath);
else if (mode === "phase-b" && dbPath) await phaseB(dbPath);
else await orchestrate();
