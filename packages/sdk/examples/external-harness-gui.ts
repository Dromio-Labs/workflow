import { runWorkflowGui } from "../src/sdk/index.js";
import { externalHarnessApp } from "./external-harness-app.js";

await runWorkflowGui(externalHarnessApp, {
  defaultInput: "Explain durable external harness delegation.",
  hostname: "127.0.0.1",
  port: Number(process.env.DROMIO_GUI_PORT ?? 4320),
});
