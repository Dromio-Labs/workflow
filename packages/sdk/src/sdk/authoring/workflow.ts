import { readFileSync } from "node:fs";
import {
  defineOperationContract,
  type QuestionResolverRegistry,
  type StepContractSourceMap,
} from "../core/index.js";
import type {
  ModelWorkerSource,
  WorkflowCatalogItem,
  WorkflowDocument,
  WorkflowDocumentContract,
} from "../product/index.js";
import {
  compileWorkflowDocument,
  createWorkflowWorkspace,
  workflowDocumentSchema,
} from "../product/workflow-document/index.js";
import { createWorkflowCatalog } from "../product/catalog/catalog.js";
import type { WorkflowTriggerDescriptor } from "@dromio/workflow-room-protocol";
import type { SignalDefinition } from "./signal.js";

type CompiledWorkflow = ReturnType<typeof compileWorkflowDocument>;
type WorkflowWorkspace = ReturnType<typeof createWorkflowWorkspace>;
type WorkflowConfig = object;

export type AuthoredWorkflowSource = {
  readonly catalog: ReturnType<typeof createWorkflowCatalog>;
  readonly document: WorkflowDocument;
  readonly questionResolvers?: QuestionResolverRegistry;
};

export type AuthoredWorkflowDefinition = {
  description?: string;
  documentId: string;
  id: string;
  title: string;
  triggers: readonly WorkflowTriggerDescriptor[];
  type: "workflow";
};

export type AuthoredWorkflow<
  TInputContracts extends StepContractSourceMap = StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap = StepContractSourceMap,
  TConfig extends WorkflowConfig = WorkflowConfig,
> = CompiledWorkflow & {
  readonly catalog: ReturnType<typeof createWorkflowCatalog>;
  readonly config?: TConfig;
  readonly definition: AuthoredWorkflowDefinition;
  readonly document: WorkflowDocument;
  readonly input: TInputContracts;
  readonly output: TOutputContracts;
  readonly questionResolvers: QuestionResolverRegistry;
  readonly signals: readonly SignalDefinition[];
  readonly triggers: readonly WorkflowTriggerDescriptor[];
  readonly workflows: readonly AuthoredWorkflowSource[];
  readonly workspace: WorkflowWorkspace;
  configure(config: TConfig): CompiledWorkflow;
};

export type AuthoredWorkflowInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
  TConfig extends WorkflowConfig = WorkflowConfig,
  TUse = unknown,
> = {
  catalog: readonly WorkflowCatalogItem[];
  config?: TConfig;
  document: string | URL | WorkflowDocument;
  input?: TInputContracts;
  model?: ModelWorkerSource;
  output?: TOutputContracts;
  questionResolvers?: QuestionResolverRegistry;
  triggers?: readonly WorkflowTriggerDescriptor[];
  use?: TUse;
  workflows?: readonly AuthoredWorkflowSource[];
};

export function workflow<
  const TInputContracts extends StepContractSourceMap = StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap = StepContractSourceMap,
  const TConfig extends WorkflowConfig = WorkflowConfig,
  TUse = unknown,
>(input: AuthoredWorkflowInput<TInputContracts, TOutputContracts, TConfig, TUse>): AuthoredWorkflow<
  TInputContracts,
  TOutputContracts,
  TConfig
> {
  const document = readDocument(input.document);
  const workflowCatalog = createWorkflowCatalog([...input.catalog]);
  const workflows = mergeWorkflowSources([
    ...(input.workflows ?? []),
    ...input.catalog.flatMap(authoredItemWorkflows),
  ]);
  const childWorkflows = Object.fromEntries(workflows.map((child) => [
    child.document.id,
    {
      catalog: child.catalog,
      document: child.document,
    },
  ]));
  const questionResolvers = Object.assign(
    {},
    ...input.catalog.map(authoredItemQuestionResolvers),
    input.questionResolvers ?? {},
  ) as QuestionResolverRegistry;
  const compileInput = {
    catalog: workflowCatalog,
    childWorkflows,
    config: input.config,
    document,
    model: input.model,
    questionResolvers,
    use: input.use,
  };
  const compiled = compileWorkflowDocument<unknown>(compileInput);
  const workflowInput = input.input
    ?? documentContracts(document, document.trigger.id, "input", document.trigger.input);
  const workflowOutput = input.output
    ?? documentContracts(document, document.end.id, "output", document.end.output);
  return Object.assign(compiled, {
    catalog: workflowCatalog,
    config: input.config,
    definition: {
      description: document.description,
      documentId: document.id,
      id: document.id,
      title: document.label ?? document.id,
      triggers: input.triggers ?? [],
      type: "workflow" as const,
    },
    document,
    input: workflowInput as TInputContracts,
    output: workflowOutput as TOutputContracts,
    questionResolvers,
    signals: input.catalog.flatMap((item) => authoredItemSignals(item)),
    triggers: input.triggers ?? [],
    workflows,
    configure(config: TConfig) {
      return compileWorkflowDocument<unknown>({
        ...compileInput,
        config,
      });
    },
    workspace: createWorkflowWorkspace({
      catalog: workflowCatalog,
      compile: { childWorkflows, model: input.model },
      document,
      id: document.id,
    }),
  });
}

function authoredItemSignals(item: WorkflowCatalogItem): readonly SignalDefinition[] {
  const value = (item as WorkflowCatalogItem & {
    signals?: readonly SignalDefinition[];
  }).signals;
  return value ?? [];
}

function authoredItemWorkflows(item: WorkflowCatalogItem): readonly AuthoredWorkflowSource[] {
  const value = (item as WorkflowCatalogItem & {
    workflows?: readonly AuthoredWorkflowSource[];
  }).workflows;
  return value ?? [];
}

function authoredItemQuestionResolvers(item: WorkflowCatalogItem): QuestionResolverRegistry {
  return (item as WorkflowCatalogItem & {
    questionResolvers?: QuestionResolverRegistry;
  }).questionResolvers ?? {};
}

function mergeWorkflowSources(
  workflows: readonly AuthoredWorkflowSource[],
): readonly AuthoredWorkflowSource[] {
  return [...new Map(workflows.map((workflow) => [workflow.document.id, workflow])).values()];
}

function readDocument(source: AuthoredWorkflowInput<StepContractSourceMap, StepContractSourceMap>["document"]) {
  if (typeof source === "object" && !(source instanceof URL)) {
    return workflowDocumentSchema.parse(source);
  }
  return workflowDocumentSchema.parse(readJson(source));
}

function readJson(source: string | URL): unknown {
  return JSON.parse(readFileSync(source, "utf8"));
}

function documentContracts(
  document: WorkflowDocument,
  boundaryId: string,
  side: "input" | "output",
  contracts: Record<string, WorkflowDocumentContract> | undefined,
): StepContractSourceMap {
  return Object.fromEntries(Object.entries(contracts ?? {}).map(([key, contract]) => [
    key,
    defineOperationContract({
      id: `${document.id}.${boundaryId}.${side}.${key}`,
      jsonSchema: contract.jsonSchema,
    }),
  ]));
}
