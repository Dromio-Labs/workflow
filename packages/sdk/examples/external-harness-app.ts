import { z } from "zod";
import {
  step,
  workflow,
  workflowApp,
} from "../src/sdk/index.js";
import type {
  TriggerRegistryStore,
} from "../src/sdk/workflow-control-plane/index.js";

const prepare = step({
  id: "demo.prepare",
  input: { request: z.string() },
  output: { brief: z.string() },
  run: ({ input }) => ({ brief: `Prepared request: ${input.request}` }),
});

const clarify = step.ask({
  answer: z.enum(["brief", "standard", "deep"]),
  id: "demo.clarify",
  input: { brief: z.string() },
  mapAnswer: ({ answer, input }) => ({ brief: input.brief, depth: answer }),
  output: { brief: z.string(), depth: z.string() },
  question: () => ({
    id: "research-depth",
    options: ["brief", "standard", "deep"].map((value) => ({
      label: value,
      value,
    })),
    prompt: "How thorough should the external research be?",
    title: "Research depth",
    type: "choice",
  }),
});

const research = step.delegate({
  capabilities: { preferred: ["subagents"], required: ["browser"] },
  context: ({ input }) => ({ brief: input.brief, depth: input.depth }),
  id: "demo.research",
  input: { brief: z.string(), depth: z.string() },
  instructions: ({ input }) =>
    `Use public web sources to produce a ${input.depth}, cited response for: ${input.brief}`,
  output: {
    report: z.string().min(20),
    sources: z.array(z.string().url()).min(1),
  },
  summary: "Research the request and return a cited structured report.",
  title: "External research",
});

const approve = step.approval({
  decision: z.enum(["approve", "reject"]),
  id: "demo.approve",
  input: { report: z.string(), sources: z.array(z.string().url()) },
  mapDecision: ({ decision, input }) => ({
    approved: decision === "approve",
    report: input.report,
    sources: input.sources,
  }),
  output: {
    approved: z.boolean(),
    report: z.string(),
    sources: z.array(z.string().url()),
  },
  reject: ({ decision }) => decision === "reject" ? "The report was rejected." : undefined,
  request: ({ input }) => ({ report: input.report, sources: input.sources }),
  title: "Approve the researched report",
});

export const externalHarnessWorkflow = workflow({
  catalog: [prepare, clarify, research, approve],
  document: {
    edges: [
      { id: "trigger-prepare", source: "request", target: "prepare" },
      { id: "prepare-clarify", source: "prepare", target: "clarify" },
      { id: "clarify-research", source: "clarify", target: "research" },
      { id: "research-approve", source: "research", target: "approve" },
      { id: "approve-end", source: "approve", target: "end" },
    ],
    end: {
      id: "end",
      output: {
        approved: { jsonSchema: { type: "boolean" } },
        report: { jsonSchema: { type: "string" } },
        sources: { jsonSchema: { items: { type: "string" }, type: "array" } },
      },
      type: "result",
    },
    id: "external-harness-golden",
    nodes: [
      { catalogItemId: prepare.id, id: "prepare" },
      { catalogItemId: clarify.id, id: "clarify" },
      { catalogItemId: research.id, id: "research" },
      { catalogItemId: approve.id, id: "approve" },
    ],
    trigger: {
      id: "request",
      input: { request: { jsonSchema: { type: "string" } } },
      type: "manual",
    },
    version: 1,
  },
  input: { request: z.string() },
  output: {
    approved: z.boolean(),
    report: z.string(),
    sources: z.array(z.string().url()),
  },
});

export const externalHarnessApp = workflowApp({
  id: "external-harness-demo",
  title: "External harness workflow",
  workflows: [externalHarnessWorkflow],
});

export const externalHarnessTriggerStore: TriggerRegistryStore = {
  read: () => ({
    triggers: [{
      auth: { mode: "none" },
      enabled: true,
      id: "external-harness.request",
      input: {
        jsonSchema: {
          additionalProperties: false,
          properties: { request: { type: "string" } },
          required: ["request"],
          type: "object",
        },
        mode: "body",
      },
      label: "Request external research",
      source: { triggerId: "request" },
      type: "http",
      workflowId: externalHarnessWorkflow.id,
    }],
    version: 1,
  }),
};
