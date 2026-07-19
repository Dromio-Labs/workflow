import {
  readFile,
} from "node:fs/promises";
import {
  bytesToArrayBuffer,
  contentBytes,
  mediaTypeForArtifactName,
  safeFileName,
  sha256,
} from "./artifacts.js";
import {
  assertBundleMatchesRelease,
  bundleWithTriggers,
  normalizeBundleWorkflow,
  normalizeReleaseVersion,
  normalizeSlug,
  releaseInputTriggers,
} from "./normalize.js";
import type {
  HttpWorkflowAppReleaseRegistryConfig,
  WorkflowAppReleaseRegistry,
  WorkflowUploadReleaseArtifactInput,
} from "./types.js";

export function createHttpWorkflowAppReleaseRegistry(
  config: HttpWorkflowAppReleaseRegistryConfig,
): WorkflowAppReleaseRegistry {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const fetchImpl = config.fetch ?? fetch;

  return {
    createRelease(input) {
      const orgSlug = normalizeSlug(input.orgSlug, "org slug");
      const appSlug = normalizeSlug(input.appSlug, "app slug");
      const version = normalizeReleaseVersion(input.version);
      const workflows = input.workflows.map(normalizeBundleWorkflow);
      const triggers = releaseInputTriggers(input);
      const bundle = bundleWithTriggers(input.bundle, triggers);
      assertBundleMatchesRelease(bundle, orgSlug, appSlug, version);
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(orgSlug)}/${pathSegment(appSlug)}/releases`, {
        body: {
          ...input,
          appSlug,
          bundle,
          orgSlug,
          triggers,
          version,
          workflows,
        },
        headers: configHeaders(config),
        method: "POST",
      });
    },
    getApp(input) {
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(input.orgSlug)}/${pathSegment(input.slug)}`, {
        headers: configHeaders(config),
        method: "GET",
        nullOnNotFound: true,
      });
    },
    listReleases(input) {
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(input.orgSlug)}/${pathSegment(input.appSlug)}/releases`, {
        headers: configHeaders(config),
        method: "GET",
      });
    },
    promoteRelease(input) {
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(input.orgSlug)}/${pathSegment(input.appSlug)}/aliases/${pathSegment(input.alias)}`, {
        body: { version: input.version },
        headers: configHeaders(config),
        method: "PUT",
      });
    },
    publishRelease(input) {
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(input.orgSlug)}/${pathSegment(input.appSlug)}/releases/${pathSegment(input.version)}/publish`, {
        headers: configHeaders(config),
        method: "POST",
      });
    },
    registerApp(input) {
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps`, {
        body: input,
        headers: configHeaders(config),
        method: "POST",
      });
    },
    async uploadArtifact(input) {
      const orgSlug = normalizeSlug(input.orgSlug, "org slug");
      const appSlug = normalizeSlug(input.appSlug, "app slug");
      const version = normalizeReleaseVersion(input.version);
      const artifactRequest = await httpArtifactRequest(input.artifact);
      return requestJson(fetchImpl, `${baseUrl}/api/intent/apps/${pathSegment(orgSlug)}/${pathSegment(appSlug)}/releases/${pathSegment(version)}/artifact`, {
        body: artifactRequest.body,
        headers: mergeHeaders(configHeaders(config), artifactRequest.headers),
        method: "POST",
        rawBody: artifactRequest.rawBody,
      });
    },
  };
}

type HttpArtifactRequest = {
  body?: Record<string, unknown>;
  headers?: HeadersInit;
  rawBody?: BodyInit;
};

async function httpArtifactRequest(
  artifact: WorkflowUploadReleaseArtifactInput["artifact"],
): Promise<HttpArtifactRequest> {
  const name = safeFileName(artifact.name);
  let bytes: Uint8Array | undefined;
  if (artifact.filePath) {
    bytes = await readFile(artifact.filePath);
  } else if (artifact.content !== undefined) {
    bytes = await contentBytes(artifact.content);
  } else if (artifact.contentBase64) {
    bytes = Buffer.from(artifact.contentBase64, "base64");
  }
  const metadata = {
    kind: artifact.kind,
    mediaType: artifact.mediaType ?? mediaTypeForArtifactName(name),
    name,
    platform: artifact.platform,
    ...(artifact.url ? { url: artifact.url } : {}),
  };
  if (bytes) {
    return {
      headers: {
        "content-type": "application/octet-stream",
        "x-intent-artifact-metadata": encodeArtifactMetadata({
          ...metadata,
          sha256: artifact.sha256 ?? sha256(bytes),
          size: artifact.size ?? bytes.length,
        }),
      },
      rawBody: new Blob([bytesToArrayBuffer(bytes)], { type: "application/octet-stream" }),
    };
  }
  return {
    body: {
      ...metadata,
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      ...(typeof artifact.size === "number" ? { size: artifact.size } : {}),
    },
  };
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  input: {
    body?: unknown;
    headers: HeadersInit | Promise<HeadersInit>;
    method: string;
    nullOnNotFound?: boolean;
    rawBody?: BodyInit;
  },
): Promise<T> {
  const headers = headersRecord(await input.headers);
  const body = input.rawBody !== undefined
    ? input.rawBody
    : input.body === undefined
      ? undefined
      : JSON.stringify(input.body);
  const response = await fetchImpl(url, {
    body,
    headers: {
      ...headers,
      ...(input.body === undefined || input.rawBody !== undefined ? {} : { "content-type": "application/json" }),
    },
    method: input.method,
  });
  if (input.nullOnNotFound && response.status === 404) return null as T;
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Workflow app release registry request failed: ${response.status} ${response.statusText}${bodyText ? ` ${bodyText}` : ""}`);
  }
  return await response.json() as T;
}

async function mergeHeaders(base: HeadersInit | Promise<HeadersInit>, extra?: HeadersInit): Promise<HeadersInit> {
  return {
    ...headersRecord(await base),
    ...headersRecord(extra),
  };
}

async function configHeaders(config: HttpWorkflowAppReleaseRegistryConfig): Promise<HeadersInit> {
  const explicit = typeof config.headers === "function" ? await config.headers() : config.headers;
  return {
    ...headersRecord(explicit),
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  };
}

function headersRecord(input?: HeadersInit): Record<string, string> {
  if (!input) return {};
  if (input instanceof Headers) {
    const output: Record<string, string> = {};
    input.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input);
  }
  return input as Record<string, string>;
}

function encodeArtifactMetadata(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
