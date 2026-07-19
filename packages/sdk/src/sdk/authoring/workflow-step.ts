import {
  ask,
  type InferStepContractInput,
  type InferStepContractOutput,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  runChildWorkflow,
  type ChildWorkflowSession,
} from "../product/workflow/child-workflow.js";
import {
  baseStep,
  type AuthoredStepDefinition,
} from "./step.js";
import {
  workflow as compileAuthoredWorkflow,
  type AuthoredWorkflow,
} from "./workflow.js";
import type {
  WorkflowCatalogExample,
  WorkflowCatalogItemKind,
} from "../product/catalog/catalog.js";

export type AuthoredWorkflowStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = {
  capabilities?: string[];
  description?: string;
  examples?: WorkflowCatalogExample[];
  id: string;
  intents?: string[];
  kind?: WorkflowCatalogItemKind;
  label?: string;
  maxRetries?: number;
  sideEffects?: string[];
  tags?: string[];
  verbs?: string[];
  workflow: AuthoredWorkflow<TInputContracts, TOutputContracts>;
};

export type AuthoredWorkflowStepDefinition<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = AuthoredStepDefinition<TInputContracts, TOutputContracts> & {
  readonly workflow: AuthoredWorkflow<TInputContracts, TOutputContracts>;
};

export function workflowStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
>(input: AuthoredWorkflowStepInput<TInputContracts, TOutputContracts>): AuthoredWorkflowStepDefinition<
  TInputContracts,
  TOutputContracts
> {
  const childSessions = new Map<string, ChildWorkflowSession>();
  const definition = baseStep({
    capabilities: input.capabilities,
    description: input.description ?? input.workflow.definition.description,
    examples: input.examples,
    execution: {
      childWorkflowDocumentId: input.workflow.document.id,
      kind: "loop",
    },
    id: input.id,
    intents: input.intents,
    implementation: {
      children: input.workflow.document.nodes.map((node) => node.catalogItemId),
      kind: "composite",
      workflowDocumentId: input.workflow.document.id,
    },
    input: input.workflow.input,
    kind: input.kind ?? "workflow",
    label: input.label ?? input.workflow.definition.title,
    maxRetries: input.maxRetries,
    output: input.workflow.output,
    sideEffects: input.sideEffects,
    tags: input.tags,
    verbs: input.verbs,
    async run(context) {
      const sessionKey = `${context.step.runId}:${context.step.id}`;
      const childWorkflow = compileAuthoredWorkflow({
        catalog: input.workflow.catalog.items(),
        config: input.workflow.config,
        document: input.workflow.document,
        input: input.workflow.input,
        model: context.model,
        output: input.workflow.output,
        use: context.use,
        workflows: input.workflow.workflows,
      });
      try {
        const session = await runChildWorkflow({
          allowWaiting: true,
          answers: context.answers,
          childWorkflowId: childWorkflow.id,
          emit: context.emit,
          input: context.input satisfies InferStepContractInput<TInputContracts>,
          parentStepId: context.step.id,
          parentTrace: {
            spanId: `step:${context.step.id}:attempt:${context.step.attempt}`,
            traceId: context.step.runId,
          },
          phase: "child workflow",
          session: childSessions.get(sessionKey),
          spanIdPrefix: `child:${context.step.id}`,
          stepIdPrefix: context.step.id,
          workflow: childWorkflow,
        });
        if (session.status === "waiting") {
          childSessions.set(sessionKey, session);
          return ask(session.pendingQuestions ?? []);
        }
        childSessions.delete(sessionKey);
        return outputFromState(childWorkflow.output, session.state);
      } catch (error) {
        childSessions.delete(sessionKey);
        throw error;
      }
    },
  });
  return Object.assign(definition, { workflow: input.workflow });
}

function outputFromState<TContracts extends StepContractSourceMap>(
  contracts: TContracts,
  state: Record<string, unknown>,
): InferStepContractOutput<TContracts> {
  return Object.fromEntries(
    Object.keys(contracts).map((key) => [key, state[key]]),
  ) as InferStepContractOutput<TContracts>;
}
