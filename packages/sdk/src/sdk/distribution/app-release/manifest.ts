import {
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import {
  writeJsonFile,
} from "./json-files.js";
import {
  normalizeBundleTrigger,
  normalizeBundleWorkflow,
  normalizeReleaseVersion,
  normalizeSlug,
} from "./normalize.js";
import type {
  CreateWorkflowAppBundleManifestInput,
  WorkflowAppBundleManifest,
} from "./types.js";

export function createWorkflowAppBundleManifest(
  input: CreateWorkflowAppBundleManifestInput,
): WorkflowAppBundleManifest {
  if (input.workflows.length === 0) {
    throw new Error("Cannot create an app bundle manifest without at least one workflow.");
  }
  const appSlug = normalizeSlug(input.appSlug, "app slug");
  const version = normalizeReleaseVersion(input.version);
  const triggers = input.triggers?.map(normalizeBundleTrigger);
  return {
    app: {
      description: input.appDescription,
      name: input.appName.trim(),
      slug: appSlug,
    },
    bundle: {
      createdAt: input.createdAt ?? new Date().toISOString(),
      distPath: input.distPath,
      entrypoint: input.entrypoint,
      name: input.bundleName ?? `${appSlug}-${version}`,
    },
    release: {
      channel: input.channel ?? "stable",
      version,
    },
    schemaVersion: 1,
    ...(triggers ? { triggers } : {}),
    workflows: input.workflows.map(normalizeBundleWorkflow),
  };
}

export async function writeWorkflowAppBundleManifest(
  bundleDir: string,
  manifest: WorkflowAppBundleManifest,
): Promise<string> {
  await mkdir(bundleDir, { recursive: true });
  const manifestPath = path.join(bundleDir, "workflow-app-bundle.json");
  await writeJsonFile(manifestPath, manifest);
  return manifestPath;
}
