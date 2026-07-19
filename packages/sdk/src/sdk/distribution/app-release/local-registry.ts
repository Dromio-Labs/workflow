import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  contentBytes,
  mediaTypeForArtifactName,
  safeFileName,
  sha256,
} from "./artifacts.js";
import {
  readJsonFile,
  writeJsonFile,
} from "./json-files.js";
import {
  assertBundleMatchesRelease,
  bundleWithTriggers,
  normalizeAlias,
  normalizeBundleWorkflow,
  normalizeReleaseVersion,
  normalizeSlug,
  releaseInputTriggers,
  sameArtifactDefinition,
  sameReleaseDefinition,
} from "./normalize.js";
import type {
  WorkflowAppRelease,
  WorkflowAppReleaseRegistry,
  WorkflowRegisteredApp,
  WorkflowReleaseAliasResult,
  LocalWorkflowAppReleaseRegistryConfig,
} from "./types.js";

export function createLocalWorkflowAppReleaseRegistry(
  config: LocalWorkflowAppReleaseRegistryConfig,
): WorkflowAppReleaseRegistry {
  const rootDir = path.resolve(config.rootDir);

  return {
    async createRelease(input) {
      const app = await requireLocalApp(rootDir, input.orgSlug, input.appSlug);
      const version = normalizeReleaseVersion(input.version);
      const workflows = input.workflows.map(normalizeBundleWorkflow);
      const triggers = releaseInputTriggers(input);
      const bundle = bundleWithTriggers(input.bundle, triggers);
      assertBundleMatchesRelease(bundle, app.orgSlug, app.slug, version);
      const existing = await readLocalRelease(rootDir, app.orgSlug, app.slug, version);
      if (existing) {
        if (!sameReleaseDefinition(existing, {
          bundle,
          channel: input.channel ?? bundle.release.channel,
          notes: input.notes,
          triggers,
          workflows,
        })) {
          throw new Error(`Workflow app release ${app.orgSlug}/${app.slug}@${version} already exists with different content.`);
        }
        return existing;
      }
      const now = new Date().toISOString();
      const release: WorkflowAppRelease = {
        appId: app.appId,
        appSlug: app.slug,
        artifacts: [],
        bundle,
        channel: input.channel ?? bundle.release.channel,
        createdAt: now,
        notes: input.notes,
        orgSlug: app.orgSlug,
        releaseId: `${app.appId}:${version}`,
        status: "draft",
        triggers,
        updatedAt: now,
        version,
        workflows,
      };
      await writeLocalRelease(rootDir, release);
      return release;
    },

    async getApp(input) {
      return await readLocalApp(rootDir, input.orgSlug, input.slug);
    },

    async listReleases(input) {
      const app = await requireLocalApp(rootDir, input.orgSlug, input.appSlug);
      const releasesDir = localReleasesDir(rootDir, app.orgSlug, app.slug);
      let entries: string[] = [];
      try {
        entries = await readdir(releasesDir);
      } catch {
        return [];
      }
      const releases = await Promise.all(entries.map(async (entry) => {
        try {
          return await readJsonFile<WorkflowAppRelease>(path.join(releasesDir, entry, "release.json"));
        } catch {
          return undefined;
        }
      }));
      return releases
        .filter((release): release is WorkflowAppRelease => Boolean(release))
        .sort((left, right) => left.version.localeCompare(right.version));
    },

    async promoteRelease(input) {
      const release = await requireLocalRelease(rootDir, input.orgSlug, input.appSlug, input.version);
      if (release.status !== "published") {
        throw new Error(`Cannot promote ${release.appSlug}@${release.version} because it is ${release.status}.`);
      }
      const result: WorkflowReleaseAliasResult = {
        alias: normalizeAlias(input.alias),
        appSlug: release.appSlug,
        orgSlug: release.orgSlug,
        promotedAt: new Date().toISOString(),
        version: release.version,
      };
      const aliasDir = path.join(localAppDir(rootDir, release.orgSlug, release.appSlug), "aliases");
      await mkdir(aliasDir, { recursive: true });
      await writeJsonFile(path.join(aliasDir, `${result.alias}.json`), result);
      return result;
    },

    async publishRelease(input) {
      const release = await requireLocalRelease(rootDir, input.orgSlug, input.appSlug, input.version);
      if (release.status === "published") {
        return release;
      }
      const now = new Date().toISOString();
      const next: WorkflowAppRelease = {
        ...release,
        publishedAt: release.publishedAt ?? now,
        status: "published",
        updatedAt: now,
      };
      await writeLocalRelease(rootDir, next);
      return next;
    },

    async registerApp(input) {
      const orgSlug = normalizeSlug(input.orgSlug, "org slug");
      const slug = normalizeSlug(input.slug, "app slug");
      const existing = await readLocalApp(rootDir, orgSlug, slug);
      const now = new Date().toISOString();
      const app: WorkflowRegisteredApp = {
        appId: existing?.appId ?? `${orgSlug}/${slug}`,
        createdAt: existing?.createdAt ?? now,
        description: input.description,
        displayName: input.displayName.trim(),
        orgSlug,
        sdkName: input.sdkName,
        slug,
        updatedAt: now,
        visibility: input.visibility ?? existing?.visibility ?? "private",
      };
      await mkdir(localAppDir(rootDir, orgSlug, slug), { recursive: true });
      await writeJsonFile(localAppPath(rootDir, orgSlug, slug), app);
      return app;
    },

    async uploadArtifact(input) {
      const release = await requireLocalRelease(rootDir, input.orgSlug, input.appSlug, input.version);
      const artifactName = safeFileName(input.artifact.name);
      const artifactDir = path.join(localReleaseDir(rootDir, release.orgSlug, release.appSlug, release.version), "artifacts");
      const artifactPath = path.join(artifactDir, artifactName);

      let content: Uint8Array | undefined;
      if (input.artifact.filePath) {
        content = await readFile(input.artifact.filePath);
      } else if (input.artifact.content !== undefined) {
        content = await contentBytes(input.artifact.content);
      } else if (input.artifact.contentBase64 !== undefined) {
        content = Buffer.from(input.artifact.contentBase64, "base64");
      } else if (!input.artifact.url) {
        throw new Error("Release artifact upload requires filePath, contentBase64, content, or url.");
      }

      const artifact = {
        artifactId: `${release.releaseId}:${input.artifact.platform ?? "default"}:${artifactName}`,
        createdAt: new Date().toISOString(),
        kind: input.artifact.kind,
        mediaType: input.artifact.mediaType ?? mediaTypeForArtifactName(artifactName),
        name: artifactName,
        platform: input.artifact.platform,
        sha256: content ? sha256(content) : input.artifact.sha256 ?? "",
        size: content ? content.length : input.artifact.size ?? 0,
        url: input.artifact.url ?? `file://${artifactPath}`,
      };
      const existing = release.artifacts.find((item) => item.name === artifact.name && item.platform === artifact.platform);
      if (existing) {
        if (!sameArtifactDefinition(existing, artifact)) {
          throw new Error(`Workflow app release artifact ${artifact.name} already exists with different content.`);
        }
        return existing;
      }
      if (content) {
        await mkdir(artifactDir, { recursive: true });
        if (input.artifact.filePath) {
          await copyFile(input.artifact.filePath, artifactPath);
        } else {
          await writeFile(artifactPath, content);
        }
      }
      const next: WorkflowAppRelease = {
        ...release,
        artifacts: [
          ...release.artifacts,
          artifact,
        ],
        updatedAt: new Date().toISOString(),
      };
      await writeLocalRelease(rootDir, next);
      return artifact;
    },
  };
}

async function requireLocalApp(rootDir: string, orgSlug: string, slug: string): Promise<WorkflowRegisteredApp> {
  const app = await readLocalApp(rootDir, orgSlug, slug);
  if (!app) throw new Error(`Workflow app ${orgSlug}/${slug} is not registered.`);
  return app;
}

async function readLocalApp(rootDir: string, orgSlug: string, slug: string): Promise<WorkflowRegisteredApp | null> {
  try {
    return await readJsonFile(localAppPath(rootDir, orgSlug, slug));
  } catch {
    return null;
  }
}

async function requireLocalRelease(
  rootDir: string,
  orgSlug: string,
  appSlug: string,
  version: string,
): Promise<WorkflowAppRelease> {
  try {
    return await readJsonFile(path.join(localReleaseDir(rootDir, orgSlug, appSlug, version), "release.json"));
  } catch {
    throw new Error(`Workflow app release ${orgSlug}/${appSlug}@${version} does not exist.`);
  }
}

async function readLocalRelease(
  rootDir: string,
  orgSlug: string,
  appSlug: string,
  version: string,
): Promise<WorkflowAppRelease | undefined> {
  try {
    return await readJsonFile(path.join(localReleaseDir(rootDir, orgSlug, appSlug, version), "release.json"));
  } catch {
    return undefined;
  }
}

async function writeLocalRelease(rootDir: string, release: WorkflowAppRelease): Promise<void> {
  await writeJsonFile(path.join(localReleaseDir(rootDir, release.orgSlug, release.appSlug, release.version), "release.json"), release);
}

function localAppDir(rootDir: string, orgSlug: string, slug: string): string {
  return path.join(rootDir, "apps", normalizeSlug(orgSlug, "org slug"), normalizeSlug(slug, "app slug"));
}

function localAppPath(rootDir: string, orgSlug: string, slug: string): string {
  return path.join(localAppDir(rootDir, orgSlug, slug), "app.json");
}

function localReleasesDir(rootDir: string, orgSlug: string, appSlug: string): string {
  return path.join(localAppDir(rootDir, orgSlug, appSlug), "releases");
}

function localReleaseDir(rootDir: string, orgSlug: string, appSlug: string, version: string): string {
  return path.join(localReleasesDir(rootDir, orgSlug, appSlug), normalizeReleaseVersion(version));
}
