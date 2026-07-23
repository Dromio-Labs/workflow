import {
  createWorkflowAppHost,
} from "../src/sdk/index.js";
import {
  createWorkflowControlPlaneMcpProvider,
} from "../src/sdk/workflow-control-plane/mcp.js";
import {
  runTriggerWorker,
} from "../src/sdk/workflow-control-plane/index.js";
import {
  externalHarnessApp,
  externalHarnessTriggerStore,
} from "./external-harness-app.js";

const host = await createWorkflowAppHost(externalHarnessApp, {
  storage: { kind: "memory" },
  triggerStore: externalHarnessTriggerStore,
});
const mcp = createWorkflowControlPlaneMcpProvider({
  controlPlane: host.controlPlane,
  name: "dromio",
  toolPrefix: "dromio",
});
const abort = new AbortController();
void runTriggerWorker({
  controlPlane: host.controlPlane,
  disableScheduleLoop: true,
  intervalMs: 50,
  signal: abort.signal,
  workerId: "external-harness-demo-worker",
});

const port = Number(process.env.DROMIO_MCP_PORT ?? 4319);
const server = Bun.serve({ fetch: mcp.fetch, hostname: "127.0.0.1", idleTimeout: 255, port });
console.error(`Dromio Workflow MCP listening at http://127.0.0.1:${server.port}/mcp`);
process.on("SIGINT", () => {
  abort.abort();
  server.stop();
  process.exit(0);
});
