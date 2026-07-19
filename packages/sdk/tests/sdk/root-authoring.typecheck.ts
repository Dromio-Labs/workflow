import {
  catalog,
  promptFile,
  runWorkflowCli,
  runWorkflowGui,
  runWorkflowSvg,
  runWorkflowTui,
  step,
  workflow,
  workflowApp,
} from "@dromio/workflow";
import { z } from "zod";
import { defineScorePolicy, promptedOperationEvaluationSchema } from "@dromio/workflow/core";

const messageSchema = z.string();
const messageWorkflowConfig: { prefix: string } = { prefix: "Written" };

const writeMessage = step({
  config: {
    defaults: { prefix: "Written" },
    resolve: (defaults, placement) => ({
      prefix: typeof placement.prefix === "string" ? placement.prefix : defaults.prefix,
    }),
  },
  id: "example.write-message",
  input: { message: messageSchema },
  output: { written: messageSchema },
  sideEffects: ["filesystem.write"],
  async run({ artifacts, config, input }) {
    artifacts.file({ mediaType: "text/plain", path: "/tmp/message.txt" });
    return { written: `${config.prefix}: ${input.message}` };
  },
});

const workflowCatalog = catalog([writeMessage]);
const generateMessage = step.model({
  id: "example.generate-message",
  input: { message: messageSchema },
  output: { written: messageSchema },
  prompt: promptFile(new URL("./generate-message.md", import.meta.url)),
});
const qualityPolicy = defineScorePolicy({
  gaps: [],
  gates: [{ id: "gate.pass", minScore: 0.8, nextAction: "complete", status: "pass" }],
  id: "score.example.message",
  risks: [],
  satisfies: [],
});
const gateMessage = step.gate({
  id: "example.gate-message",
  input: { evaluation: promptedOperationEvaluationSchema },
  policy: qualityPolicy,
});
const askAudience = step.ask({
  answer: z.string().trim().min(1),
  id: "example.ask-audience",
  input: { message: messageSchema },
  mapAnswer: ({ answer, input }) => ({
    written: `${input.message}: ${answer}`,
  }),
  output: { written: messageSchema },
  question: ({ input }) => ({
    id: "audience",
    prompt: `Who should receive ${input.message}?`,
    type: "text",
  }),
});
const evaluateMessage = step.evaluate({
  evaluator: {
    output: { evaluation: promptedOperationEvaluationSchema },
    prompt: promptFile(new URL("./evaluate-message.md", import.meta.url)),
  },
  id: "example.evaluate-message",
  input: { message: messageSchema },
  policy: qualityPolicy,
});
const messageWorkflow = workflow({
  catalog: [writeMessage],
  config: messageWorkflowConfig,
  document: {
    edges: [
      { id: "trigger-to-write", source: "trigger", target: "write" },
      { id: "write-to-end", source: "write", target: "end" },
    ],
    end: { id: "end", output: { written: { jsonSchema: { type: "string" } } }, type: "result" },
    id: "message-workflow",
    nodes: [{ catalogItemId: writeMessage.id, id: "write" }],
    trigger: { id: "trigger", input: { message: { jsonSchema: { type: "string" } } }, type: "manual" },
    version: 1,
  },
  input: { message: messageSchema },
  output: { written: messageSchema },
});
messageWorkflow.configure({ prefix: "Configured" });
// @ts-expect-error workflow configuration is inferred from messageWorkflowConfig
messageWorkflow.configure({ prefix: 42 });
const nestedMessage = step.workflow({
  id: "example.nested-message",
  workflow: messageWorkflow,
});
const routeMessage = step.router({
  id: "example.route-message",
  routes: { alternate: messageWorkflow, standard: messageWorkflow },
  select: ({ input }) => input.message.startsWith("alternate") ? "alternate" : "standard",
});
const inspectMessage = step({
  id: "example.inspect-message",
  input: { message: messageSchema },
  output: { inspected: messageSchema },
  run: ({ input }) => ({ inspected: input.message }),
});
const inspectionWorkflow = workflow({
  catalog: [inspectMessage],
  document: {
    edges: [
      { id: "trigger-to-inspect", source: "trigger", target: "inspect" },
      { id: "inspect-to-end", source: "inspect", target: "end" },
    ],
    end: { id: "end", output: { inspected: { jsonSchema: { type: "string" } } }, type: "result" },
    id: "inspection-workflow",
    nodes: [{ catalogItemId: inspectMessage.id, id: "inspect" }],
    trigger: { id: "trigger", input: { message: { jsonSchema: { type: "string" } } }, type: "manual" },
    version: 1,
  },
  input: { message: messageSchema },
  output: { inspected: messageSchema },
});
const forkMessages = step.fork({
  branches: { inspection: inspectionWorkflow, writing: messageWorkflow },
  id: "example.fork-messages",
});
const writeMessages = step.forEach({
  collect: "writtenMessages",
  id: "example.write-messages",
  items: "messages",
  workflow: messageWorkflow,
});
const messageApp = workflowApp({
  defaultWorkflow: messageWorkflow,
  id: "message-app",
  workflows: [messageWorkflow, inspectionWorkflow],
});
const runtimeStep = workflowCatalog.createStep("example.write-message", {
  stepId: "write-message-placement",
});

void runtimeStep;
void generateMessage;
void gateMessage;
void askAudience;
void evaluateMessage;
void nestedMessage;
void routeMessage;
void forkMessages;
void writeMessages;
void runWorkflowCli(messageApp, { argv: ["hello"], exit: false });
void runWorkflowGui;
void runWorkflowSvg;
void runWorkflowTui(messageApp);
void step.waitFor;
