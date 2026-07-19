import type {
  WorkflowAppBundleManifest,
  WorkflowAppBundleTrigger,
  WorkflowAppBundleWorkflow,
  WorkflowAppRelease,
  WorkflowCreateReleaseInput,
  WorkflowReleaseArtifact,
} from "./types.js";

export function normalizeBundleWorkflow(workflow: WorkflowAppBundleWorkflow): WorkflowAppBundleWorkflow {
  const workflowId = normalizeWorkflowId(workflow.workflowId);
  return {
    description: workflow.description,
    label: workflow.label.trim() || workflowId,
    metadata: workflow.metadata,
    nodeCount: workflow.nodeCount,
    source: workflow.source,
    workflowId,
  };
}

export function normalizeBundleTrigger(trigger: WorkflowAppBundleTrigger): WorkflowAppBundleTrigger {
  const id = normalizeWorkflowId(trigger.id);
  const workflowId = normalizeWorkflowId(trigger.workflowId);
  return {
    auth: trigger.auth,
    config: normalizeTriggerConfig(trigger.config),
    description: trigger.description,
    enabled: Boolean(trigger.enabled),
    id,
    input: trigger.input,
    label: trigger.label.trim() || id,
    source: trigger.source,
    type: trigger.type,
    workflowId,
  };
}

export function releaseInputTriggers(input: WorkflowCreateReleaseInput): WorkflowAppBundleTrigger[] {
  return (input.triggers ?? input.bundle.triggers ?? []).map(normalizeBundleTrigger);
}

export function bundleWithTriggers(
  bundle: WorkflowAppBundleManifest,
  triggers: WorkflowAppBundleTrigger[],
): WorkflowAppBundleManifest {
  const withoutTriggers: WorkflowAppBundleManifest = { ...bundle };
  delete withoutTriggers.triggers;
  return {
    ...withoutTriggers,
    ...(triggers.length ? { triggers } : {}),
  };
}

export function normalizeSlug(value: string, label: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Missing ${label}.`);
  return slug;
}

export function normalizeWorkflowId(value: string): string {
  const workflowId = value.trim();
  if (!workflowId) throw new Error("Workflow id is required.");
  if (!/^[A-Za-z0-9._:-]+$/.test(workflowId)) {
    throw new Error(`Invalid workflow id: ${workflowId}`);
  }
  return workflowId;
}

export function normalizeReleaseVersion(value: string): string {
  const version = value.trim().replace(/^v/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return version;
}

export function normalizeAlias(value: string): string {
  const alias = normalizeSlug(value, "release alias");
  if (alias === "releases" || alias === "apps") throw new Error(`Reserved release alias: ${alias}`);
  return alias;
}

export function assertBundleMatchesRelease(
  bundle: WorkflowAppBundleManifest,
  orgSlug: string,
  appSlug: string,
  version: string,
): void {
  const expectedAppSlug = normalizeSlug(appSlug, "app slug");
  const expectedVersion = normalizeReleaseVersion(version);
  if (bundle.app.slug !== expectedAppSlug) {
    throw new Error(`Bundle app slug ${bundle.app.slug} does not match release app ${expectedAppSlug}.`);
  }
  if (bundle.release.version !== expectedVersion) {
    throw new Error(`Bundle version ${bundle.release.version} does not match release version ${expectedVersion}.`);
  }
  normalizeSlug(orgSlug, "org slug");
}

export function sameReleaseDefinition(
  release: WorkflowAppRelease,
  input: {
    bundle: WorkflowAppBundleManifest;
    channel: string;
    notes?: string;
    triggers: WorkflowAppBundleTrigger[];
    workflows: WorkflowAppBundleWorkflow[];
  },
): boolean {
  const releaseTriggers = release.triggers ?? release.bundle.triggers ?? [];
  return release.channel === input.channel &&
    (release.notes ?? undefined) === (input.notes ?? undefined) &&
    stableJson(release.bundle) === stableJson(input.bundle) &&
    stableJson(releaseTriggers.map(normalizeBundleTrigger)) === stableJson(input.triggers.map(normalizeBundleTrigger)) &&
    stableJson(release.workflows.map(normalizeBundleWorkflow)) === stableJson(input.workflows.map(normalizeBundleWorkflow));
}

export function sameArtifactDefinition(
  existing: WorkflowReleaseArtifact,
  next: WorkflowReleaseArtifact,
): boolean {
  return existing.kind === next.kind &&
    existing.mediaType === next.mediaType &&
    existing.name === next.name &&
    (existing.platform ?? undefined) === (next.platform ?? undefined) &&
    existing.sha256 === next.sha256 &&
    existing.size === next.size &&
    existing.url === next.url;
}

function normalizeTriggerConfig(
  config: WorkflowAppBundleTrigger["config"],
): WorkflowAppBundleTrigger["config"] {
  if (!config) return undefined;
  return {
    ...config,
    ...(typeof config.method === "string" ? { method: config.method.toUpperCase() } : {}),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
