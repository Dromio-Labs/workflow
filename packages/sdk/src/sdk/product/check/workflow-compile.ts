import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowCatalogConfigRequirement,
  WorkflowCatalogItem,
  WorkflowCatalogRuntimeDependency,
} from "../catalog/index.js";
import {
  workflowDocumentSchema,
  type WorkflowDocument,
  type WorkflowDocumentContract,
  type WorkflowDocumentEdge,
  type WorkflowDocumentLoop,
} from "../workflow-document/index.js";
import {
  loadWorkbenchCatalog,
  resolveCatalogSource,
  type WorkflowValidateCatalog,
} from "./workflow-validate-catalog.js";
import {
  validateDromioWorkbench,
} from "./workflow-validate.js";
import {
  runtimeToolDescriptors,
  type DromioRuntimeToolDescriptor,
} from "./workflow-compile-runtime-tools.js";
import type {
  ValidateError,
  ValidateOutput,
  WorkflowValidateResult,
} from "./workflow-validate-types.js";
import {
  workbenchName,
  workflowFilesForInput,
} from "./workflow-workbench-files.js";

export type DromioCompileInput = {
  cwd?: string;
  mode?: "full" | "render-only";
  outDir?: string;
  workflowId?: string;
  write?: boolean;
};

export type DromioCompiledContractFact = {
  description?: string;
  jsonSchema?: unknown;
  key: string;
};

export type DromioCompiledStepFact = {
  catalogItemId: string;
  configKeys: string[];
  description?: string;
  id: string;
  implementation?: {
    factory?: string;
    kind: string;
    resolvedPath?: string;
    source?: string;
  };
  inputKeys: string[];
  kind?: string;
  label: string;
  outputKeys: string[];
  sideEffects: string[];
};

export type DromioCompiledBddScenario = {
  given: string[];
  id: string;
  tags: string[];
  then: string[];
  title: string;
  when: string[];
};

export type DromioCompileArtifact = {
  artifactVersion: 1;
  bddScenarios: DromioCompiledBddScenario[];
  dependencies: {
    catalogItemIds: string[];
    configRequirements: Array<WorkflowCatalogConfigRequirement & { catalogItemId: string }>;
    implementationSources: Array<{
      catalogItemId: string;
      resolvedPath?: string;
      source: string;
    }>;
    runtimeDependencies: Array<WorkflowCatalogRuntimeDependency & { catalogItemId: string }>;
    sideEffects: string[];
  };
  edges: WorkflowDocumentEdge[];
  end: {
    id: string;
    label?: string;
    output: DromioCompiledContractFact[];
    type: string;
  };
  governance: {
    approvals: [];
    evaluations: [];
    humanInTheLoop: boolean;
    publishable: boolean;
    riskNotes: string[];
    schemaGaps: string[];
  };
  loops: WorkflowDocumentLoop[];
  paths: {
    compileArtifact: string;
    document: string;
    glue?: string;
  };
  steps: DromioCompiledStepFact[];
  topology: {
    edgeCount: number;
    kind: "branching" | "linear" | "loop";
    nodeCount: number;
    reachableNodeIds: string[];
    terminalNodeIds: string[];
  };
  runtimeTools: DromioRuntimeToolDescriptor[];
  trigger: {
    id: string;
    input: DromioCompiledContractFact[];
    label?: string;
    type: string;
  };
  validation: {
    errors: ValidateError[];
    mode: "full" | "render-only";
    valid: boolean;
  };
  workbench: string;
  workflow: {
    description?: string;
    id: string;
    label?: string;
    version: number;
  };
};

export type DromioCompileOutput = {
  artifacts: DromioCompileArtifact[];
  outDir: string;
  mode: "full" | "render-only";
  summary: {
    compiled: number;
    total: number;
    written: number;
  };
  valid: boolean;
  validation: ValidateOutput;
  workbench: string;
};

export async function compileDromioWorkbench(input: DromioCompileInput = {}): Promise<DromioCompileOutput> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const mode = input.mode ?? "full";
  const outDir = path.resolve(cwd, input.outDir ?? ".dromio/compile");
  const workflowFiles = await workflowFilesForInput({ cwd, workflowId: input.workflowId });
  const [catalog, validation, name] = await Promise.all([
    loadWorkbenchCatalog(cwd),
    validateDromioWorkbench({ cwd, mode, workflowId: input.workflowId }),
    workbenchName(cwd),
  ]);
  const validationsById = new Map(validation.workflows.map((result) => [result.id, result]));
  const artifacts: DromioCompileArtifact[] = [];
  for (const filePath of workflowFiles) {
    const parsed = workflowDocumentSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
    if (!parsed.success) continue;
    artifacts.push(compileWorkflowArtifact({
      catalog,
      cwd,
      document: parsed.data,
      filePath,
      outDir,
      validation: validationsById.get(parsed.data.id),
      validationMode: mode,
      workbench: name,
    }));
  }
  let written = 0;
  if (input.write !== false) {
    await mkdir(outDir, { recursive: true });
    for (const artifact of artifacts) {
      await writeFile(
        path.join(outDir, `${artifact.workflow.id}.json`),
        `${JSON.stringify(artifact, null, 2)}\n`,
      );
      written += 1;
    }
  }
  return {
    artifacts,
    mode,
    outDir,
    summary: {
      compiled: artifacts.length,
      total: workflowFiles.length,
      written,
    },
    valid: validation.valid,
    validation,
    workbench: name,
  };
}

function compileWorkflowArtifact(input: {
  catalog: WorkflowValidateCatalog;
  cwd: string;
  document: WorkflowDocument;
  filePath: string;
  outDir: string;
  validation?: WorkflowValidateResult;
  validationMode: "full" | "render-only";
  workbench: string;
}): DromioCompileArtifact {
  const steps = input.document.nodes.map((node) =>
    stepFact({
      catalogItem: input.catalog.get(node.catalogItemId),
      catalogItemId: node.catalogItemId,
      configKeys: Object.keys(node.config ?? {}),
      cwd: input.cwd,
      description: node.description,
      id: node.id,
      label: node.label,
    })
  );
  const dependencies = dependencyFacts(steps, input.document.nodes, input.catalog);
  const validation = input.validation ?? {
    errors: [],
    id: input.document.id,
    valid: true,
  };
  const paths = artifactPaths({
    cwd: input.cwd,
    document: input.document,
    filePath: input.filePath,
    outDir: input.outDir,
  });
  const topology = topologyFacts(input.document);
  const governance = governanceFacts({
    dependencies,
    mode: input.validationMode,
    validation,
  });
  const scenarios = bddScenarios(input.document, steps, dependencies);
  return {
    artifactVersion: 1,
    bddScenarios: scenarios,
    dependencies,
    edges: input.document.edges,
    end: {
      id: input.document.end.id,
      label: input.document.end.label,
      output: contractFacts(input.document.end.output),
      type: input.document.end.type ?? "result",
    },
    governance,
    loops: input.document.loops ?? [],
    paths,
    steps,
    topology,
    runtimeTools: runtimeToolDescriptors({
      bddScenarios: scenarios,
      dependencies,
      document: input.document,
    }),
    trigger: {
      id: input.document.trigger.id,
      input: contractFacts(input.document.trigger.input),
      label: input.document.trigger.label,
      type: input.document.trigger.type,
    },
    validation: {
      errors: validation.errors,
      mode: input.validationMode,
      valid: validation.valid,
    },
    workbench: input.workbench,
    workflow: {
      description: input.document.description,
      id: input.document.id,
      label: input.document.label,
      version: input.document.version,
    },
  };
}

function stepFact(input: {
  catalogItem: WorkflowCatalogItem | undefined;
  catalogItemId: string;
  configKeys: string[];
  cwd: string;
  description?: string;
  id: string;
  label?: string;
}): DromioCompiledStepFact {
  const implementation = input.catalogItem?.implementation;
  const source = implementation?.source;
  const resolvedPath = source ? resolveCatalogSource(input.cwd, source) : undefined;
  return {
    catalogItemId: input.catalogItemId,
    configKeys: input.configKeys,
    description: input.description ?? input.catalogItem?.description,
    id: input.id,
    implementation: implementation
      ? {
        factory: implementation.factory,
        kind: implementation.kind,
        resolvedPath: resolvedPath ? relativePath(input.cwd, resolvedPath) : undefined,
        source,
      }
      : undefined,
    inputKeys: Object.keys(input.catalogItem?.inputs ?? {}),
    kind: input.catalogItem?.kind,
    label: input.label ?? input.catalogItem?.label ?? input.id,
    outputKeys: Object.keys(input.catalogItem?.outputs ?? {}),
    sideEffects: [...(input.catalogItem?.sideEffects ?? [])],
  };
}

function dependencyFacts(
  steps: DromioCompiledStepFact[],
  nodes: WorkflowDocument["nodes"],
  catalog: WorkflowValidateCatalog,
): DromioCompileArtifact["dependencies"] {
  const configRequirements: DromioCompileArtifact["dependencies"]["configRequirements"] = [];
  const implementationSources: DromioCompileArtifact["dependencies"]["implementationSources"] = [];
  const runtimeDependencies: DromioCompileArtifact["dependencies"]["runtimeDependencies"] = [];
  for (const node of nodes) {
    const item = catalog.get(node.catalogItemId);
    for (const requirement of item?.configRequirements ?? []) {
      configRequirements.push({ ...requirement, catalogItemId: node.catalogItemId });
    }
    for (const dependency of item?.runtimeDependencies ?? []) {
      runtimeDependencies.push({ ...dependency, catalogItemId: node.catalogItemId });
    }
  }
  for (const step of steps) {
    const source = step.implementation?.source;
    if (source) {
      implementationSources.push({
        catalogItemId: step.catalogItemId,
        resolvedPath: step.implementation?.resolvedPath,
        source,
      });
    }
  }
  return {
    catalogItemIds: unique(steps.map((step) => step.catalogItemId)),
    configRequirements,
    implementationSources,
    runtimeDependencies,
    sideEffects: unique(steps.flatMap((step) => step.sideEffects)),
  };
}

function governanceFacts(input: {
  dependencies: DromioCompileArtifact["dependencies"];
  mode: "full" | "render-only";
  validation: WorkflowValidateResult;
}): DromioCompileArtifact["governance"] {
  const schemaGaps = [
    "workflow documents do not yet declare evaluations",
    "workflow documents do not yet declare approval gates",
  ];
  const riskNotes = [...schemaGaps];
  if (!input.validation.valid) {
    riskNotes.unshift("workflow has validation errors");
  }
  if (input.mode === "render-only") {
    riskNotes.unshift("render-only compile does not prove publish readiness");
  }
  if (input.dependencies.sideEffects.length > 0) {
    riskNotes.push(`side effects require publish review: ${input.dependencies.sideEffects.join(", ")}`);
  }
  return {
    approvals: [],
    evaluations: [],
    humanInTheLoop: false,
    publishable: input.mode === "full" && input.validation.valid,
    riskNotes,
    schemaGaps,
  };
}

function topologyFacts(document: WorkflowDocument): DromioCompileArtifact["topology"] {
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of document.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const branching = [...outgoing.values()].some((count) => count > 1) ||
    [...incoming.values()].some((count) => count > 1);
  const reachableIds = reachableNodeIds(document);
  return {
    edgeCount: document.edges.length,
    kind: (document.loops?.length ?? 0) > 0 ? "loop" : branching ? "branching" : "linear",
    nodeCount: document.nodes.length,
    reachableNodeIds: reachableIds,
    terminalNodeIds: document.edges
      .filter((edge) => edge.target === document.end.id)
      .map((edge) => edge.source)
      .filter((id) => document.nodes.some((node) => node.id === id))
      .sort(),
  };
}

function reachableNodeIds(document: WorkflowDocument): string[] {
  const bySource = new Map<string, string[]>();
  for (const edge of document.edges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge.target]);
  }
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const reachable = new Set<string>();
  const queue = [document.trigger.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(bySource.get(id) ?? []));
  }
  return [...reachable].filter((id) => nodeIds.has(id)).sort();
}

function bddScenarios(
  document: WorkflowDocument,
  steps: DromioCompiledStepFact[],
  dependencies: DromioCompileArtifact["dependencies"],
): DromioCompiledBddScenario[] {
  const stepList = steps.map((step) => step.id).join(", ") || "no steps";
  const scenarios: DromioCompiledBddScenario[] = [
    {
      given: [`workflow ${document.id} is published with trigger ${document.trigger.id}`],
      id: `${document.id}.accepts-trigger-input`,
      tags: ["workflow", "trigger"],
      then: [`the run records trigger input keys: ${contractKeys(document.trigger.input).join(", ") || "none"}`],
      title: "Workflow accepts its declared trigger input",
      when: ["an actor starts the workflow with a valid input payload"],
    },
    {
      given: [`workflow ${document.id} has graph topology ${topologyFacts(document).kind}`],
      id: `${document.id}.runs-catalog-steps`,
      tags: ["workflow", "catalog"],
      then: [`the run visits the catalog-backed nodes: ${stepList}`],
      title: "Workflow runs reachable catalog steps",
      when: ["the workflow runtime advances from trigger to end"],
    },
    {
      given: [`workflow ${document.id} references ${dependencies.catalogItemIds.length} catalog item ids`],
      id: `${document.id}.resolves-catalog-implementations`,
      tags: ["catalog", "implementation"],
      then: [`the compile artifact records implementation sources: ${dependencies.implementationSources.length}`],
      title: "Catalog implementations resolve before publish",
      when: ["the workbench is compiled"],
    },
    {
      given: [`workflow ${document.id} reaches end boundary ${document.end.id}`],
      id: `${document.id}.returns-end-output`,
      tags: ["workflow", "output"],
      then: [`the run returns output keys: ${contractKeys(document.end.output).join(", ") || "none"}`],
      title: "Workflow returns its declared end output",
      when: ["all required steps complete successfully"],
    },
  ];
  if (dependencies.sideEffects.length > 0) {
    scenarios.push({
      given: [`workflow ${document.id} declares side effects: ${dependencies.sideEffects.join(", ")}`],
      id: `${document.id}.reviews-side-effects`,
      tags: ["governance", "side-effects"],
      then: ["publish review can inspect those effects from the compile artifact"],
      title: "Side effects are visible before publish",
      when: ["the workflow is prepared for a governed release"],
    });
  }
  return scenarios;
}

function contractFacts(
  contracts: Record<string, WorkflowDocumentContract> | undefined,
): DromioCompiledContractFact[] {
  return Object.entries(contracts ?? {}).map(([key, contract]) => ({
    description: contract.description,
    jsonSchema: contract.jsonSchema,
    key,
  }));
}

function contractKeys(contracts: Record<string, WorkflowDocumentContract> | undefined): string[] {
  return Object.keys(contracts ?? {});
}

function artifactPaths(input: {
  cwd: string;
  document: WorkflowDocument;
  filePath: string;
  outDir: string;
}): DromioCompileArtifact["paths"] {
  const gluePath = path.join(input.cwd, "workflows", input.document.id, "workflow.ts");
  return {
    compileArtifact: relativePath(input.cwd, path.join(input.outDir, `${input.document.id}.json`)),
    document: relativePath(input.cwd, input.filePath),
    glue: relativePath(input.cwd, gluePath),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function relativePath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).replace(/\\/g, "/");
}
