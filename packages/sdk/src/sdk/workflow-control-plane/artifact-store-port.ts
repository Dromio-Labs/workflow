import { randomUUID } from "node:crypto";
import type {
  WorkflowRunArtifactRef,
} from "../core/index.js";
import type {
  ArtifactStoreGetInput,
  ArtifactStorePort,
  ArtifactStorePutInput,
} from "../product/index.js";
import type {
  IdGenerator,
  WorkflowRuntimeStore,
} from "./types.js";
import {
  ARTIFACT_BYTE_CONTENT_ENCODING,
  ARTIFACT_CONTENT_ENCODING_METADATA_KEY,
  storedArtifactContentFromBytes,
  storedArtifactContentToBytes,
} from "./artifact-content-codec.js";
export {
  ARTIFACT_BYTE_CONTENT_ENCODING,
  ARTIFACT_CONTENT_ENCODING_METADATA_KEY,
  storedArtifactContentFromBytes,
  storedArtifactContentToBytes,
} from "./artifact-content-codec.js";

export type CreateArtifactStorePortInput = {
  idGenerator?: IdGenerator;
  runId?: string;
  runtimeStore: WorkflowRuntimeStore;
};

export class ArtifactContentNotFoundError extends Error {
  constructor(readonly artifactId: string) {
    super(`Unknown workflow artifact content: ${artifactId}`);
    this.name = "ArtifactContentNotFoundError";
  }
}

export function createArtifactStorePort(input: CreateArtifactStorePortInput): ArtifactStorePort {
  const ids = input.idGenerator ?? randomIdGenerator;
  return {
    async put(artifact) {
      const putContent = input.runtimeStore.putArtifactContent;
      if (!putContent) throw new Error("Workflow runtime store does not support artifact content writes.");

      const artifactId = ids.id("artifact");
      const encoded = encodeArtifactContent(artifact);
      const ref: WorkflowRunArtifactRef = {
        artifactId,
        kind: artifact.kind,
        ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
        ...(encoded.metadata ? { metadata: encoded.metadata } : {}),
        ...(artifact.title ? { title: artifact.title } : {}),
        uri: `artifact:${artifactId}`,
      };
      await putContent.call(input.runtimeStore, {
        artifactId,
        content: encoded.content,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        metadata: encoded.metadata,
        title: artifact.title,
      });
      if (input.runId && input.runtimeStore.recordArtifactRef) {
        await input.runtimeStore.recordArtifactRef(input.runId, ref);
      }
      return ref;
    },
    async get(refOrArtifactId) {
      const getContent = input.runtimeStore.getArtifactContent;
      if (!getContent) throw new Error("Workflow runtime store does not support artifact content reads.");

      const artifactId = artifactIdFromInput(refOrArtifactId);
      const stored = await getContent.call(input.runtimeStore, artifactId);
      if (!stored) throw new ArtifactContentNotFoundError(artifactId);
      return {
        content: decodeArtifactContent(stored.ref, stored.content),
        ref: stored.ref,
      };
    },
  };
}

function encodeArtifactContent(input: ArtifactStorePutInput): {
  content: string;
  metadata?: WorkflowRunArtifactRef["metadata"];
} {
  if (input.bytes !== undefined) {
    return {
      content: storedArtifactContentFromBytes({
        bytes: input.bytes,
        metadata: {
          [ARTIFACT_CONTENT_ENCODING_METADATA_KEY]: ARTIFACT_BYTE_CONTENT_ENCODING,
        },
      }),
      metadata: {
        ...(input.metadata ?? {}),
        [ARTIFACT_CONTENT_ENCODING_METADATA_KEY]: ARTIFACT_BYTE_CONTENT_ENCODING,
      },
    };
  }
  if (input.text !== undefined) {
    return {
      content: input.text,
      metadata: input.metadata,
    };
  }
  return {
    content: JSON.stringify(input.value),
    metadata: input.metadata,
  };
}

function decodeArtifactContent(ref: WorkflowRunArtifactRef, content: string): string | Uint8Array {
  return ref.metadata?.[ARTIFACT_CONTENT_ENCODING_METADATA_KEY] === ARTIFACT_BYTE_CONTENT_ENCODING
    ? storedArtifactContentToBytes({ content, metadata: ref.metadata })
    : content;
}

function artifactIdFromInput(input: ArtifactStoreGetInput): string {
  return typeof input === "string" ? input : input.artifactId;
}

const randomIdGenerator: IdGenerator = {
  id(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "")}`;
  },
};
