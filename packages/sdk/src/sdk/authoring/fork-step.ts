import {
  jsonSchemaFromContractSource,
  type InferStepContractOutput,
  type StepContractSourceMap,
} from "../core/index.js";
import {
  forkWorkflowStep,
  createWorkflowForkBranch,
} from "../product/step/workflow-fork-step.js";
import {
  authoredStepDefinition,
  type AuthoredStepDefinition,
} from "./step.js";
import type { AuthoredWorkflow } from "./workflow.js";

type WorkflowInputContracts<TWorkflow> =
  TWorkflow extends AuthoredWorkflow<infer TInput, StepContractSourceMap> ? TInput : never;
type WorkflowOutputContracts<TWorkflow> =
  TWorkflow extends AuthoredWorkflow<StepContractSourceMap, infer TOutput> ? TOutput : never;
type UnionToIntersection<TValue> =
  (TValue extends TValue ? (value: TValue) => void : never) extends
    (value: infer TIntersection) => void ? TIntersection : never;

export type AuthoredForkBranches = Record<
  string,
  AuthoredWorkflow<StepContractSourceMap, StepContractSourceMap>
>;

export type ForkInputContracts<TBranches extends AuthoredForkBranches> =
  UnionToIntersection<WorkflowInputContracts<TBranches[keyof TBranches]>> & StepContractSourceMap;

export type ForkOutputContracts<TBranches extends AuthoredForkBranches> =
  UnionToIntersection<WorkflowOutputContracts<TBranches[keyof TBranches]>> & StepContractSourceMap;

export type AuthoredForkStepInput<TBranches extends AuthoredForkBranches> = {
  branches: TBranches;
  description?: string;
  id: string;
  label?: string;
  maxRetries?: number;
};

export function forkStep<const TBranches extends AuthoredForkBranches>(
  input: AuthoredForkStepInput<TBranches>,
): AuthoredStepDefinition<
  ForkInputContracts<TBranches>,
  ForkOutputContracts<TBranches>
> {
  const branchEntries = Object.entries(input.branches);
  if (branchEntries.length < 2) {
    throw new Error("step.fork requires at least two workflow branches.");
  }
  const inputContracts = mergeInputContracts(branchEntries) as ForkInputContracts<TBranches>;
  const outputContracts = mergeOutputContracts(branchEntries) as ForkOutputContracts<TBranches>;
  return authoredStepDefinition({
    description: input.description,
    execution: {
      branches: branchEntries.map(([id, child]) => ({
        childWorkflowDocumentId: child.document.id,
        id,
        label: child.definition.title,
      })),
      joinPolicy: "all",
      kind: "fork",
      label: input.label,
    },
    id: input.id,
    implementation: {
      children: branchEntries.flatMap(([, child]) =>
        child.document.nodes.map((node) => node.catalogItemId)
      ),
      kind: "composite",
    },
    input: inputContracts,
    kind: "fork",
    label: input.label,
    maxRetries: input.maxRetries,
    output: outputContracts,
  }, (createInput) =>
    forkWorkflowStep({
      description: input.description,
      id: createInput.stepId ?? input.id,
      input: inputContracts,
      label: input.label,
      maxRetries: input.maxRetries,
      output: outputContracts,
      branches(scope) {
        return branchEntries.map(([branchId, child]) => createWorkflowForkBranch({
          childInput: selectInput(child.input, scope.input),
          createWorkflow: child,
          id: branchId,
          label: child.definition.title,
          mapResult: (session) => outputFromState(child.output, session.state),
          workflow: { documentId: child.document.id, id: child.id },
        }));
      },
      join(results) {
        return Object.assign({}, ...Object.values(results)) as InferStepContractOutput<
          ForkOutputContracts<TBranches>
        >;
      },
    })
  );
}

function mergeInputContracts(
  branches: Array<[string, AuthoredWorkflow]>,
): StepContractSourceMap {
  const contracts: StepContractSourceMap = {};
  for (const [branchId, workflow] of branches) {
    for (const [key, contract] of Object.entries(workflow.input)) {
      const current = contracts[key];
      if (current && !sameContract(current, contract)) {
        throw new Error(`step.fork branch ${branchId} has an incompatible input contract for ${key}.`);
      }
      contracts[key] = contract;
    }
  }
  return contracts;
}

function mergeOutputContracts(
  branches: Array<[string, AuthoredWorkflow]>,
): StepContractSourceMap {
  const contracts: StepContractSourceMap = {};
  for (const [branchId, workflow] of branches) {
    for (const [key, contract] of Object.entries(workflow.output)) {
      if (contracts[key]) {
        throw new Error(`step.fork branch ${branchId} collides on output key ${key}.`);
      }
      contracts[key] = contract;
    }
  }
  return contracts;
}

function sameContract(
  left: StepContractSourceMap[string],
  right: StepContractSourceMap[string],
) {
  return JSON.stringify(jsonSchemaFromContractSource(left))
    === JSON.stringify(jsonSchemaFromContractSource(right));
}

function selectInput(
  contracts: StepContractSourceMap,
  input: Record<string, unknown>,
) {
  return Object.fromEntries(Object.keys(contracts).map((key) => [key, input[key]]));
}

function outputFromState(
  contracts: StepContractSourceMap,
  state: Record<string, unknown>,
) {
  return Object.fromEntries(Object.keys(contracts).map((key) => [key, state[key]]));
}
