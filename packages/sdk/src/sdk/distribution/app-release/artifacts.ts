import {
  createHash,
} from "node:crypto";

export async function contentBytes(content: BodyInit | Uint8Array | string): Promise<Uint8Array> {
  if (typeof content === "string") return Buffer.from(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  throw new Error("Unsupported artifact content type.");
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function mediaTypeForArtifactName(name: string): string {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "application/gzip";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

export function safeFileName(value: string): string {
  const name = value.trim().split(/[\\/]+/).at(-1) ?? "";
  if (!name || name === "." || name === "..") throw new Error("Artifact name is required.");
  return name.replace(/[^A-Za-z0-9._+-]+/g, "-");
}

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
