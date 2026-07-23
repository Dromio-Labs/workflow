import { runWorkflowCli } from "../src/sdk/index.js";
import { externalHarnessApp } from "./external-harness-app.js";

const result = await runWorkflowCli(externalHarnessApp, { exit: false });

if (result.run?.status === "waiting") {
  process.stdout.write(`${JSON.stringify({
    pendingHooks: result.run.pendingHooks?.map((hook) => ({
      kind: hook.kind,
      stepId: hook.stepId,
    })),
    pendingQuestions: result.run.pendingQuestions?.map((question) => ({
      id: question.id,
      prompt: question.prompt,
    })),
    runId: result.run.runId,
    status: result.run.status,
  }, null, 2)}\n`);
  process.exitCode = 0;
} else {
  process.exitCode = result.exitCode;
}
