import {
  ArtifactContentNotFoundError,
  createArtifactStorePort,
  type WorkflowRuntimeStore,
} from "../../workflow-control-plane/index.js";
import { json, jsonError } from "./serialization.js";

export const DEFAULT_ARTIFACT_HTTP_MAX_BYTES = 25 * 1024 * 1024;

export type ArtifactHttpHandlers = {
  readonly download: (request: Request, artifactId: string) => Promise<Response>;
  readonly upload: (request: Request) => Promise<Response>;
};

export function createArtifactHttpHandlers(input: {
  readonly maxBytes?: number;
  readonly runtimeStore: WorkflowRuntimeStore;
}): ArtifactHttpHandlers {
  const maxBytes = input.maxBytes ?? DEFAULT_ARTIFACT_HTTP_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Artifact HTTP maxBytes must be a positive integer.");
  }
  const artifacts = createArtifactStorePort({ runtimeStore: input.runtimeStore });
  return {
    async download(_request, artifactId) {
      try {
        const stored = await artifacts.get(artifactId);
        const bytes = typeof stored.content === "string"
          ? new TextEncoder().encode(stored.content)
          : stored.content;
        const body = new Uint8Array(bytes.byteLength);
        body.set(bytes);
        return new Response(body.buffer, {
          headers: {
            "content-length": String(body.byteLength),
            "content-type": stored.ref.mediaType ?? "application/octet-stream",
          },
        });
      } catch (error) {
        if (error instanceof ArtifactContentNotFoundError) {
          return jsonError("ARTIFACT_NOT_FOUND", error.message, 404);
        }
        throw error;
      }
    },
    async upload(request) {
      try {
        const upload = await readArtifactUpload(request, maxBytes);
        const ref = await artifacts.put({
          bytes: upload.bytes,
          kind: upload.kind,
          mediaType: upload.mediaType,
          ...(upload.title ? { title: upload.title } : {}),
        });
        return json(ref, 201);
      } catch (error) {
        if (error instanceof ArtifactHttpRequestError) {
          return jsonError(error.code, error.message, error.status);
        }
        throw error;
      }
    },
  };
}

type ArtifactUpload = {
  readonly bytes: Uint8Array;
  readonly kind: string;
  readonly mediaType: string;
  readonly title?: string;
};

class ArtifactHttpRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ArtifactHttpRequestError";
  }
}

async function readArtifactUpload(request: Request, maxBytes: number): Promise<ArtifactUpload> {
  const contentType = request.headers.get("content-type")?.trim();
  if (!contentType) {
    throw new ArtifactHttpRequestError(
      "ARTIFACT_CONTENT_TYPE_REQUIRED",
      "Artifact upload requires a content-type header.",
      400,
    );
  }
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return readMultipartUpload(request, maxBytes);
  }
  const kind = request.headers.get("x-dromio-artifact-kind")?.trim();
  if (!kind) {
    throw new ArtifactHttpRequestError(
      "ARTIFACT_KIND_REQUIRED",
      "Raw artifact upload requires x-dromio-artifact-kind.",
      400,
    );
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw tooLarge(maxBytes);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  assertSize(bytes.byteLength, maxBytes);
  return {
    bytes,
    kind,
    mediaType: mediaType(contentType),
    ...(headerValue(request, "x-dromio-artifact-title") ? {
      title: headerValue(request, "x-dromio-artifact-title"),
    } : {}),
  };
}

async function readMultipartUpload(
  request: Request,
  maxBytes: number,
): Promise<ArtifactUpload> {
  const value = (await request.formData()).get("file");
  if (!(value instanceof Blob)) {
    throw new ArtifactHttpRequestError(
      "ARTIFACT_FILE_REQUIRED",
      "Multipart artifact upload requires a file field.",
      400,
    );
  }
  assertSize(value.size, maxBytes);
  const name = "name" in value && typeof value.name === "string" ? value.name : undefined;
  return {
    bytes: new Uint8Array(await value.arrayBuffer()),
    kind: headerValue(request, "x-dromio-artifact-kind") ?? "file",
    mediaType: value.type || "application/octet-stream",
    ...(name ? { title: name } : {}),
  };
}

function assertSize(actual: number, maxBytes: number): void {
  if (actual > maxBytes) throw tooLarge(maxBytes);
}

function tooLarge(maxBytes: number): ArtifactHttpRequestError {
  return new ArtifactHttpRequestError(
    "ARTIFACT_TOO_LARGE",
    `Artifact exceeds the ${maxBytes}-byte upload limit.`,
    413,
  );
}

function headerValue(request: Request, name: string): string | undefined {
  return request.headers.get(name)?.trim() || undefined;
}

function mediaType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim() || "application/octet-stream";
}
