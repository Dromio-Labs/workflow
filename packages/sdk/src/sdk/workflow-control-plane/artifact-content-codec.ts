import type { WorkflowRunArtifactRef } from "../core/index.js";

export const ARTIFACT_BYTE_CONTENT_ENCODING = "base64";
export const ARTIFACT_CONTENT_ENCODING_METADATA_KEY = "dromioArtifactContentEncoding";

export function storedArtifactContentToBytes(input: {
  readonly content: string;
  readonly metadata?: WorkflowRunArtifactRef["metadata"];
}): Uint8Array {
  return input.metadata?.[ARTIFACT_CONTENT_ENCODING_METADATA_KEY] === ARTIFACT_BYTE_CONTENT_ENCODING
    ? base64ToBytes(input.content)
    : new TextEncoder().encode(input.content);
}

export function storedArtifactContentFromBytes(input: {
  readonly bytes: Uint8Array;
  readonly metadata?: WorkflowRunArtifactRef["metadata"];
}): string {
  return input.metadata?.[ARTIFACT_CONTENT_ENCODING_METADATA_KEY] === ARTIFACT_BYTE_CONTENT_ENCODING
    ? bytesToBase64(input.bytes)
    : new TextDecoder().decode(input.bytes);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
