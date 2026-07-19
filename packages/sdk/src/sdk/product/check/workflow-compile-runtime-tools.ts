import type {
  WorkflowCatalogConfigRequirement,
  WorkflowCatalogRuntimeDependency,
} from "../catalog/index.js";
import type {
  RuntimeToolApprovalPolicy,
  RuntimeToolDescriptor,
  RuntimeToolEffect,
} from "../../agents/runtime/index.js";
import type {
  WorkflowDocument,
  WorkflowDocumentContract,
} from "../workflow-document/index.js";

export type DromioRuntimeToolEffect = RuntimeToolEffect;

export type DromioRuntimeToolApprovalPolicy = RuntimeToolApprovalPolicy;

export type DromioRuntimeToolDependencySummary = {
  configRequirementIds: string[];
  runtimeDependencies: Array<{
    catalogItemIds: string[];
    id: string;
    kind: WorkflowCatalogRuntimeDependency["kind"];
    label?: string;
    required: boolean;
  }>;
  sideEffects: string[];
};

export type DromioRuntimeToolDescriptor = RuntimeToolDescriptor & {
  bddScenarioIds: string[];
  dependencies: DromioRuntimeToolDependencySummary;
  releaseVersion?: string;
  title: string;
  workflowVersion: number;
};

export type DromioRuntimeToolSourceDependencies = {
  configRequirements: Array<WorkflowCatalogConfigRequirement & { catalogItemId: string }>;
  runtimeDependencies: Array<WorkflowCatalogRuntimeDependency & { catalogItemId: string }>;
  sideEffects: string[];
};

export function runtimeToolDescriptors(input: {
  bddScenarios: Array<{ id: string }>;
  dependencies: DromioRuntimeToolSourceDependencies;
  document: WorkflowDocument;
}): DromioRuntimeToolDescriptor[] {
  const effect = runtimeToolEffect(input.dependencies);
  return [
    {
      approval: runtimeToolApproval(effect),
      bddScenarioIds: input.bddScenarios.map((scenario) => scenario.id).sort(),
      dependencies: runtimeToolDependencySummary(input.dependencies),
      description: input.document.description ??
        input.document.trigger.description ??
        input.document.label ??
        `Run workflow ${input.document.id}.`,
      effect,
      id: runtimeToolId(input.document.id),
      inputSchema: contractObjectSchema(input.document.trigger.input),
      outputSchema: contractObjectSchema(input.document.end.output),
      title: input.document.label ?? input.document.id,
      workflowId: input.document.id,
      workflowVersion: input.document.version,
    },
  ];
}

function runtimeToolId(workflowId: string): string {
  return `workflow.${workflowId}.run`;
}

function runtimeToolApproval(
  effect: DromioRuntimeToolEffect,
): DromioRuntimeToolApprovalPolicy {
  return effect === "read" ? "never" : "on-risky";
}

function runtimeToolEffect(
  dependencies: DromioRuntimeToolSourceDependencies,
): DromioRuntimeToolEffect {
  if (
    dependencies.runtimeDependencies.some((dependency) =>
      dependency.kind === "command" || dependency.kind === "http"
    ) ||
    dependencies.sideEffects.some(isExternalSideEffect)
  ) {
    return "external";
  }
  return dependencies.sideEffects.length > 0 ? "write" : "read";
}

function isExternalSideEffect(sideEffect: string): boolean {
  const normalized = sideEffect.toLowerCase();
  return [
    "api",
    "email",
    "external",
    "http",
    "model",
    "network",
    "provider",
    "slack",
    "webhook",
  ].some((token) => normalized.includes(token));
}

function runtimeToolDependencySummary(
  dependencies: DromioRuntimeToolSourceDependencies,
): DromioRuntimeToolDependencySummary {
  return {
    configRequirementIds: unique(dependencies.configRequirements.map((requirement) => requirement.id)),
    runtimeDependencies: summarizeRuntimeDependencies(dependencies.runtimeDependencies),
    sideEffects: [...dependencies.sideEffects],
  };
}

function summarizeRuntimeDependencies(
  dependencies: DromioRuntimeToolSourceDependencies["runtimeDependencies"],
): DromioRuntimeToolDependencySummary["runtimeDependencies"] {
  const byId = new Map<string, DromioRuntimeToolDependencySummary["runtimeDependencies"][number]>();
  for (const dependency of dependencies) {
    const existing = byId.get(dependency.id);
    if (existing) {
      existing.catalogItemIds = unique([...existing.catalogItemIds, dependency.catalogItemId]);
      existing.required = existing.required || dependency.required === true;
      continue;
    }
    byId.set(dependency.id, {
      catalogItemIds: [dependency.catalogItemId],
      id: dependency.id,
      kind: dependency.kind,
      label: dependency.label,
      required: dependency.required === true,
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function contractObjectSchema(
  contracts: Record<string, WorkflowDocumentContract> | undefined,
): unknown {
  const keys = Object.keys(contracts ?? {}).sort();
  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, contracts?.[key]?.jsonSchema ?? {}]),
    ),
    required: keys,
    type: "object",
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
