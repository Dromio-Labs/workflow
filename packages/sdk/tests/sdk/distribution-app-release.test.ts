import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  createHttpWorkflowAppReleaseRegistry,
  createWorkflowAppBundleManifest,
  createLocalWorkflowAppReleaseRegistry,
  DROMIO_COMPILE_ARTIFACT_METADATA_KEY,
  writeWorkflowAppBundleManifest,
  type WorkflowAppBundleTrigger,
} from "@dromio/workflow/distribution";

const workflow = {
  description: "Search processed PDF catalog output.",
  label: "Search PDFs",
  metadata: {
    [DROMIO_COMPILE_ARTIFACT_METADATA_KEY]: {
      artifactVersion: 1,
      bddScenarios: [
        {
          id: "search-pdfs.accepts-trigger-input",
          title: "Workflow accepts its declared trigger input",
        },
      ],
      governance: {
        publishable: true,
      },
      topology: {
        nodeCount: 3,
      },
      validation: {
        mode: "full",
        valid: true,
      },
      workflow: {
        id: "search-pdfs",
      },
    },
  },
  nodeCount: 3,
  source: ".dromio/workflows/search-pdfs.workflow.json",
  workflowId: "search-pdfs",
};

const trigger = {
  auth: {
    mode: "bearer",
    tokenRef: "trigger:search-pdfs.request",
  },
  config: {
    method: "post",
    path: "/api/triggers/search-pdfs.request",
  },
  description: "Search processed PDF catalog output and return normalized artifact references.",
  enabled: true,
  id: "search-pdfs.request",
  input: {
    contentType: "application/json",
    jsonRender: {
      fields: [
        {
          label: "Root directory",
          name: "rootDir",
          required: true,
          type: "text",
          valueType: "string",
        },
      ],
      schemaVersion: 1,
      submitLabel: "Run workflow",
      type: "form",
    },
    jsonSchema: {
      properties: {
        rootDir: {
          title: "Root directory",
          type: "string",
        },
      },
      required: ["rootDir"],
      type: "object",
    },
    mode: "body",
  },
  label: "Search PDFs",
  source: {
    documentPath: ".dromio/workflows/search-pdfs.workflow.json",
    triggerId: "request",
  },
  type: "http",
  workflowId: "search-pdfs",
} satisfies WorkflowAppBundleTrigger;

describe("SDK workflow app release registry", () => {
  test("creates and writes app bundle manifests", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "workflow-app-bundle-"));
    try {
      const manifest = createWorkflowAppBundleManifest({
        appDescription: "PDF search API",
        appName: "PDF Search",
        appSlug: "PDF Search",
        entrypoint: {
          apiBasePath: "/api",
          binaryName: "pdf-search",
          runtime: "native",
        },
        triggers: [trigger],
        version: "v0.1.0",
        workflows: [workflow],
      });

      expect(manifest.app.slug).toBe("pdf-search");
      expect(manifest.release.version).toBe("0.1.0");
      expect(manifest.bundle.name).toBe("pdf-search-0.1.0");
      expect(manifest.triggers?.[0]).toMatchObject({
        config: {
          method: "POST",
          path: "/api/triggers/search-pdfs.request",
        },
        id: "search-pdfs.request",
        workflowId: "search-pdfs",
      });
      expect(manifest.triggers?.[0]?.input?.jsonRender).toMatchObject({
        schemaVersion: 1,
        type: "form",
      });

      const manifestPath = await writeWorkflowAppBundleManifest(tempDir, manifest);
      const text = await readFile(manifestPath, "utf8");
      expect(text).toContain("\"schemaVersion\": 1");
      expect(text).toContain("\"workflowId\": \"search-pdfs\"");
      expect(text).toContain("\"dromioCompileArtifact\"");
      expect(text).toContain("\"id\": \"search-pdfs.request\"");
      expect(text).toContain("\"jsonRender\"");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("stores app releases and aliases in the local registry", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "intent-release-registry-"));
    try {
      const registry = createLocalWorkflowAppReleaseRegistry({ rootDir: tempDir });
      const app = await registry.registerApp({
        displayName: "PDF Search",
        orgSlug: "Team One",
        slug: "PDF Search",
        visibility: "workspace",
      });
      const manifest = createWorkflowAppBundleManifest({
        appName: app.displayName,
        appSlug: app.slug,
        entrypoint: {
          binaryName: "pdf-search",
          runtime: "native",
        },
        triggers: [trigger],
        version: "0.1.0",
        workflows: [workflow],
      });
      const triggers = manifest.triggers ?? [];

      const release = await registry.createRelease({
        appSlug: app.slug,
        bundle: manifest,
        orgSlug: app.orgSlug,
        triggers,
        version: "0.1.0",
        workflows: manifest.workflows,
      });
      expect(release.status).toBe("draft");
      expect(release.triggers).toEqual(triggers);
      expect(release.bundle.triggers).toEqual(triggers);
      const retry = await registry.createRelease({
        appSlug: app.slug,
        bundle: manifest,
        orgSlug: app.orgSlug,
        triggers,
        version: "0.1.0",
        workflows: manifest.workflows,
      });
      expect(retry.releaseId).toBe(release.releaseId);

      const artifact = await registry.uploadArtifact({
        appSlug: app.slug,
        artifact: {
          content: "bundle bytes",
          kind: "bundle",
          name: "pdf-search-0.1.0.tar.gz",
        },
        orgSlug: app.orgSlug,
        version: release.version,
      });
      expect(artifact.size).toBe("bundle bytes".length);
      expect(artifact.sha256).toHaveLength(64);
      const retryArtifact = await registry.uploadArtifact({
        appSlug: app.slug,
        artifact: {
          contentBase64: Buffer.from("bundle bytes").toString("base64"),
          kind: "bundle",
          name: "pdf-search-0.1.0.tar.gz",
        },
        orgSlug: app.orgSlug,
        version: release.version,
      });
      expect(retryArtifact).toEqual(artifact);
      await expect(registry.uploadArtifact({
        appSlug: app.slug,
        artifact: {
          content: "different bytes",
          kind: "bundle",
          name: "pdf-search-0.1.0.tar.gz",
        },
        orgSlug: app.orgSlug,
        version: release.version,
      })).rejects.toThrow("already exists with different content");

      const published = await registry.publishRelease({
        appSlug: app.slug,
        orgSlug: app.orgSlug,
        version: release.version,
      });
      expect(published.status).toBe("published");
      expect(published.artifacts).toHaveLength(1);
      const publishedAgain = await registry.publishRelease({
        appSlug: app.slug,
        orgSlug: app.orgSlug,
        version: release.version,
      });
      expect(publishedAgain).toEqual(published);

      const alias = await registry.promoteRelease({
        alias: "stable",
        appSlug: app.slug,
        orgSlug: app.orgSlug,
        version: release.version,
      });
      expect(alias.version).toBe("0.1.0");

      const releases = await registry.listReleases({
        appSlug: app.slug,
        orgSlug: app.orgSlug,
      });
      expect(releases.map((item) => item.version)).toEqual(["0.1.0"]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("rejects bundle app and version mismatches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "intent-release-registry-"));
    try {
      const registry = createLocalWorkflowAppReleaseRegistry({ rootDir: tempDir });
      const app = await registry.registerApp({
        displayName: "PDF Search",
        orgSlug: "team",
        slug: "pdf-search",
      });
      const manifest = createWorkflowAppBundleManifest({
        appName: app.displayName,
        appSlug: app.slug,
        entrypoint: {
          binaryName: "pdf-search",
          runtime: "native",
        },
        version: "0.1.0",
        workflows: [workflow],
      });
      const wrongApp = {
        ...manifest,
        app: {
          ...manifest.app,
          slug: "other-app",
        },
      };
      await expect(registry.createRelease({
        appSlug: app.slug,
        bundle: wrongApp,
        orgSlug: app.orgSlug,
        version: "0.1.0",
        workflows: manifest.workflows,
      })).rejects.toThrow("does not match release app");
      const wrongVersion = {
        ...manifest,
        release: {
          ...manifest.release,
          version: "0.2.0",
        },
      };
      await expect(registry.createRelease({
        appSlug: app.slug,
        bundle: wrongVersion,
        orgSlug: app.orgSlug,
        version: "0.1.0",
        workflows: manifest.workflows,
      })).rejects.toThrow("does not match release version");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("rejects mutable local release rewrites", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "intent-release-registry-"));
    try {
      const registry = createLocalWorkflowAppReleaseRegistry({ rootDir: tempDir });
      const app = await registry.registerApp({
        displayName: "PDF Search",
        orgSlug: "team",
        slug: "pdf-search",
      });
      const manifest = createWorkflowAppBundleManifest({
        appName: app.displayName,
        appSlug: app.slug,
        entrypoint: {
          binaryName: "pdf-search",
          runtime: "native",
        },
        version: "0.1.0",
        workflows: [workflow],
      });
      await registry.createRelease({
        appSlug: app.slug,
        bundle: manifest,
        orgSlug: app.orgSlug,
        version: "0.1.0",
        workflows: manifest.workflows,
      });
      const changed = {
        ...manifest,
        app: {
          ...manifest.app,
          name: "Changed",
        },
      };
      await expect(registry.createRelease({
        appSlug: app.slug,
        bundle: changed,
        orgSlug: app.orgSlug,
        triggers: manifest.triggers,
        version: "0.1.0",
        workflows: manifest.workflows,
      })).rejects.toThrow("already exists with different content");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("hides platform registry calls behind the HTTP adapter", async () => {
    const calls: Array<{ body?: unknown; method: string; url: string }> = [];
    const registry = createHttpWorkflowAppReleaseRegistry({
      baseUrl: "https://platform.example.com/",
      fetch: (async (url, init) => {
        calls.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          method: init?.method ?? "GET",
          url: String(url),
        });
        return Response.json({
          appId: "team/pdf-search",
          createdAt: "2026-01-01T00:00:00.000Z",
          displayName: "PDF Search",
          orgSlug: "team",
          slug: "pdf-search",
          updatedAt: "2026-01-01T00:00:00.000Z",
          visibility: "private",
        });
      }) as typeof fetch,
      token: "secret",
    });

    await registry.registerApp({
      displayName: "PDF Search",
      orgSlug: "team",
      slug: "pdf-search",
    });

    expect(calls).toEqual([{
      body: {
        displayName: "PDF Search",
        orgSlug: "team",
        slug: "pdf-search",
      },
      method: "POST",
      url: "https://platform.example.com/api/intent/apps",
    }]);
  });

  test("HTTP release creation sends trigger metadata with json-render input", async () => {
    const calls: Array<{ body?: unknown; method: string; url: string }> = [];
    const registry = createHttpWorkflowAppReleaseRegistry({
      baseUrl: "https://platform.example.com/",
      fetch: (async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({
          body,
          method: init?.method ?? "GET",
          url: String(url),
        });
        return Response.json({
          appId: "team/pdf-search",
          appSlug: "pdf-search",
          artifacts: [],
          bundle: (body as { bundle?: unknown } | undefined)?.bundle,
          channel: "stable",
          createdAt: "2026-01-01T00:00:00.000Z",
          orgSlug: "team",
          releaseId: "rel_1",
          status: "draft",
          triggers: (body as { triggers?: unknown } | undefined)?.triggers,
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: "0.1.0",
          workflows: (body as { workflows?: unknown } | undefined)?.workflows,
        });
      }) as typeof fetch,
      token: "secret",
    });
    const manifest = createWorkflowAppBundleManifest({
      appName: "PDF Search",
      appSlug: "pdf-search",
      entrypoint: {
        binaryName: "pdf-search",
        runtime: "native",
      },
      triggers: [trigger],
      version: "0.1.0",
      workflows: [workflow],
    });

    await registry.createRelease({
      appSlug: "pdf-search",
      bundle: manifest,
      orgSlug: "team",
      version: "0.1.0",
      workflows: manifest.workflows,
    });

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://platform.example.com/api/intent/apps/team/pdf-search/releases",
    });
    expect(calls[0]?.body).toMatchObject({
      bundle: {
        triggers: [
          {
            id: "search-pdfs.request",
            input: {
              jsonRender: {
                schemaVersion: 1,
                type: "form",
              },
            },
            workflowId: "search-pdfs",
          },
        ],
      },
      triggers: [
        {
          id: "search-pdfs.request",
          workflowId: "search-pdfs",
        },
      ],
      workflows: [
        {
          metadata: {
            [DROMIO_COMPILE_ARTIFACT_METADATA_KEY]: {
              artifactVersion: 1,
              workflow: {
                id: "search-pdfs",
              },
            },
          },
          workflowId: "search-pdfs",
        },
      ],
    });
  });

  test("HTTP artifact uploads include bytes instead of local paths", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "intent-http-artifact-"));
    try {
      const artifactPath = path.join(tempDir, "bundle.bin");
      await writeFile(artifactPath, "binary bytes");
      const calls: Array<{
        body?: Uint8Array | string;
        headers: Record<string, string>;
        method: string;
        url: string;
      }> = [];
      const registry = createHttpWorkflowAppReleaseRegistry({
        baseUrl: "https://platform.example.com",
        fetch: (async (url, init) => {
          calls.push({
            body: await requestBodyBytes(init?.body),
            headers: headersObject(init?.headers),
            method: init?.method ?? "GET",
            url: String(url),
          });
          return Response.json({
            artifactId: "artifact_1",
            createdAt: "2026-01-01T00:00:00.000Z",
            kind: "binary",
            mediaType: "application/octet-stream",
            name: "bundle.bin",
            sha256: "x".repeat(64),
            size: 12,
            url: "intent://team/pdf-search/0.1.0/bundle.bin",
          });
        }) as typeof fetch,
      });

      await registry.uploadArtifact({
        appSlug: "PDF Search",
        artifact: {
          filePath: artifactPath,
          kind: "binary",
          name: "bundle.bin",
        },
        orgSlug: "Team",
        version: "0.1.0",
      });

      expect(calls[0]).toMatchObject({
        method: "POST",
        url: "https://platform.example.com/api/intent/apps/team/pdf-search/releases/0.1.0/artifact",
      });
      expect(Buffer.from(calls[0]?.body as Uint8Array).toString("utf8")).toBe("binary bytes");
      expect(calls[0]?.headers["content-type"]).toBe("application/octet-stream");
      expect(decodeArtifactMetadata(calls[0]?.headers["x-intent-artifact-metadata"])).toMatchObject({
        kind: "binary",
        name: "bundle.bin",
        sha256: expect.any(String),
        size: "binary bytes".length,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

async function requestBodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | string | undefined> {
  if (!body) return undefined;
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return String(body);
}

function headersObject(input?: HeadersInit): Record<string, string> {
  if (!input) return {};
  if (input instanceof Headers) {
    const output: Record<string, string> = {};
    input.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  if (Array.isArray(input)) return Object.fromEntries(input);
  return input as Record<string, string>;
}

function decodeArtifactMetadata(value?: string): Record<string, unknown> {
  if (!value) throw new Error("Missing artifact metadata header.");
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
  const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}
