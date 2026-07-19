import type {
  CandidateScorePolicy,
  StepContractSourceMap,
  StepDefinition,
} from "../../core/index.js";
import type {
  ModelWorkerSource,
} from "../model/index.js";

export type WorkflowCatalogCreateInput = {
  config?: Record<string, unknown>;
  model?: ModelWorkerSource;
  stepId?: string;
};

export type WorkflowCatalogExample = {
  userIntent: string;
  useWhen?: string;
};

export type WorkflowCatalogConfigRequirement = {
  description?: string;
  env?: string | readonly string[];
  id: string;
  inputKey?: string;
  label?: string;
  required?: boolean;
  type?: "boolean" | "number" | "path" | "string" | "url";
};

export type WorkflowCatalogRuntimeDependency = {
  binary?: string;
  description?: string;
  env?: string | readonly string[];
  id: string;
  install?: {
    linux?: string;
    macos?: string;
    notes?: string;
  };
  kind: "command" | "env" | "http";
  label?: string;
  required?: boolean;
};

export type WorkflowCatalogItemKind =
  | "adapter"
  | "approval"
  | "builtin"
  | "composite"
  | "evaluation"
  | "forEach"
  | "fork"
  | "gate"
  | "model"
  | "primitive"
  | "question"
  | "router"
  | "step"
  | "wait"
  | "workflow";

export type WorkflowCatalogImplementation = {
  children?: string[];
  factory?: string;
  kind:
    | "adapter"
    | "builtin"
    | "composite"
    | "primitive"
    | "typescript"
    | "workflow-document";
  source?: string;
  workflowDocumentId?: string;
};

export type WorkflowCatalogExecution = {
  branches?: Array<{
    childWorkflowDocumentId: string;
    id: string;
    label?: string;
  }>;
  childWorkflowDocumentId?: string;
  itemLabelPath?: string;
  itemSource?: string;
  joinPolicy?: "all" | "any";
  kind: "forEach" | "fork" | "loop" | "router";
  label?: string;
  routes?: Array<{
    childWorkflowDocumentId: string;
    id: string;
    label?: string;
  }>;
};

export type WorkflowCatalogItem = {
  capabilities?: string[];
  configRequirements?: WorkflowCatalogConfigRequirement[];
  create?(input?: WorkflowCatalogCreateInput): StepDefinition;
  description?: string;
  examples?: WorkflowCatalogExample[];
  execution?: WorkflowCatalogExecution;
  id: string;
  implementation?: WorkflowCatalogImplementation;
  inputs?: StepContractSourceMap;
  intents?: string[];
  kind?: WorkflowCatalogItemKind;
  label: string;
  outputs?: StepContractSourceMap;
  prompts?: Record<string, string>;
  runtimeDependencies?: WorkflowCatalogRuntimeDependency[];
  sideEffects?: string[];
  scorePolicy?: CandidateScorePolicy;
  semantic?: boolean;
  tags?: string[];
  verbs?: string[];
};

export type WorkflowCatalogSearchInput = {
  capabilities?: string[];
  desiredOutputKeys?: string[];
  inputKeys?: string[];
  intent?: string;
  limit?: number;
  sideEffects?: string[];
  verbs?: string[];
};

export type WorkflowCatalogSearchResult = {
  item: WorkflowCatalogItem;
  reasons: string[];
  score: number;
};

export type WorkflowCatalog = {
  createStep(id: string, input?: WorkflowCatalogCreateInput): StepDefinition;
  get(id: string): WorkflowCatalogItem | undefined;
  items(): WorkflowCatalogItem[];
  require(id: string): WorkflowCatalogItem;
  search(input: WorkflowCatalogSearchInput): WorkflowCatalogSearchResult[];
};

export function defineCatalogItem<const TItem extends WorkflowCatalogItem>(item: TItem): TItem {
  return item;
}

export function createWorkflowCatalog(items: WorkflowCatalogItem[]): WorkflowCatalog {
  const byId = new Map<string, WorkflowCatalogItem>();
  for (const item of items) {
    if (byId.has(item.id)) {
      throw new Error(`Duplicate workflow catalog item ${item.id}.`);
    }
    byId.set(item.id, item);
  }
  return {
    createStep(id, input) {
      const item = requireCatalogItem(byId, id);
      if (!item.create) {
        throw new Error(`Workflow catalog item ${id} cannot create an executable step.`);
      }
      return item.create(input);
    },
    get(id) {
      return byId.get(id);
    },
    items() {
      return [...byId.values()];
    },
    require(id) {
      return requireCatalogItem(byId, id);
    },
    search(input) {
      return searchCatalogItems([...byId.values()], input);
    },
  };
}

export function searchCatalogItems(
  items: WorkflowCatalogItem[],
  input: WorkflowCatalogSearchInput,
): WorkflowCatalogSearchResult[] {
  const queryTokens = tokenize(input.intent);
  const capabilityTokens = new Set((input.capabilities ?? []).map(normalizeToken));
  const verbTokens = new Set((input.verbs ?? []).map(normalizeToken));
  const sideEffectTokens = new Set((input.sideEffects ?? []).map(normalizeToken));
  const inputKeys = new Set((input.inputKeys ?? []).map(normalizeToken));
  const outputKeys = new Set((input.desiredOutputKeys ?? []).map(normalizeToken));

  return items
    .map((item) => scoreCatalogItem(item, {
      capabilityTokens,
      inputKeys,
      outputKeys,
      queryTokens,
      sideEffectTokens,
      verbTokens,
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, input.limit ?? 10);
}

function scoreCatalogItem(
  item: WorkflowCatalogItem,
  input: {
    capabilityTokens: Set<string>;
    inputKeys: Set<string>;
    outputKeys: Set<string>;
    queryTokens: Set<string>;
    sideEffectTokens: Set<string>;
    verbTokens: Set<string>;
  },
): WorkflowCatalogSearchResult {
  let score = 0;
  const reasons: string[] = [];
  const textTokens = catalogTextTokens(item);
  const capabilities = new Set((item.capabilities ?? []).map(normalizeToken));
  const verbs = new Set((item.verbs ?? []).map(normalizeToken));
  const sideEffects = new Set((item.sideEffects ?? []).map(normalizeToken));
  const itemInputKeys = new Set(Object.keys(item.inputs ?? {}).map(normalizeToken));
  const itemOutputKeys = new Set(Object.keys(item.outputs ?? {}).map(normalizeToken));

  const queryMatches = intersectionSize(input.queryTokens, textTokens);
  if (queryMatches > 0) {
    score += queryMatches * 5;
    reasons.push(`Matched ${queryMatches} intent token${queryMatches === 1 ? "" : "s"}.`);
  }
  const capabilityMatches = intersectionSize(input.capabilityTokens, capabilities);
  if (capabilityMatches > 0) {
    score += capabilityMatches * 8;
    reasons.push(`Matched ${capabilityMatches} capability tag${capabilityMatches === 1 ? "" : "s"}.`);
  }
  const verbMatches = intersectionSize(input.verbTokens, verbs);
  if (verbMatches > 0) {
    score += verbMatches * 8;
    reasons.push(`Matched ${verbMatches} verb${verbMatches === 1 ? "" : "s"}.`);
  }
  const inputMatches = intersectionSize(input.inputKeys, itemInputKeys);
  if (inputMatches > 0) {
    score += inputMatches * 10;
    reasons.push(`Matched ${inputMatches} available input key${inputMatches === 1 ? "" : "s"}.`);
  }
  const outputMatches = intersectionSize(input.outputKeys, itemOutputKeys);
  if (outputMatches > 0) {
    score += outputMatches * 10;
    reasons.push(`Matched ${outputMatches} desired output key${outputMatches === 1 ? "" : "s"}.`);
  }
  const sideEffectMatches = intersectionSize(input.sideEffectTokens, sideEffects);
  if (sideEffectMatches > 0) {
    score += sideEffectMatches * 6;
    reasons.push(`Matched ${sideEffectMatches} side effect constraint${sideEffectMatches === 1 ? "" : "s"}.`);
  }

  return { item, reasons, score };
}

function catalogTextTokens(item: WorkflowCatalogItem) {
  return tokenize([
    item.id,
    item.kind,
    item.label,
    item.description,
    item.implementation?.factory,
    item.implementation?.kind,
    item.implementation?.source,
    item.implementation?.workflowDocumentId,
    ...(item.tags ?? []),
    ...(item.capabilities ?? []),
    ...(item.configRequirements ?? []).flatMap((requirement) => [
      requirement.id,
      requirement.inputKey,
      requirement.label,
      requirement.description,
      ...(Array.isArray(requirement.env) ? requirement.env : [requirement.env]),
    ]),
    ...(item.implementation?.children ?? []),
    ...(item.intents ?? []),
    ...(item.verbs ?? []),
    ...(item.examples ?? []).flatMap((example) => [example.userIntent, example.useWhen]),
  ].filter(Boolean).join(" "));
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function tokenize(value: string | undefined) {
  const tokens = new Set<string>();
  for (const token of (value ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 1) tokens.add(token);
  }
  return tokens;
}

function requireCatalogItem(byId: Map<string, WorkflowCatalogItem>, id: string) {
  const item = byId.get(id);
  if (!item) throw new Error(`Unknown workflow catalog item ${id}.`);
  return item;
}
