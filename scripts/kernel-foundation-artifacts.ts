import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { kernelFoundationPackages } from "./package-closure.js";

export type KernelFoundationArtifact = (typeof kernelFoundationPackages)[number] & {
  readonly tarballPath: string;
};

type KernelRegistryArtifact = {
  readonly integrity?: unknown;
  readonly name?: unknown;
  readonly shasum?: unknown;
  readonly tarballFile?: unknown;
  readonly version?: unknown;
};

/**
 * Loads the immutable Kernel #41 foundation set. Both the supplied registry
 * manifest and the tarball bytes must match the recorded identities, so a
 * same-version local rebuild cannot masquerade as the Kernel release.
 */
export async function loadKernelFoundationArtifacts(
  artifactDirectory: string,
): Promise<ReadonlyMap<string, KernelFoundationArtifact>> {
  const manifestPath = path.join(artifactDirectory, "package-registry-manifest.json");
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Kernel foundation manifest must be an array: ${manifestPath}`);
  }
  const registry = parsed as readonly KernelRegistryArtifact[];
  const resolved = new Map<string, KernelFoundationArtifact>();

  for (const expected of kernelFoundationPackages) {
    const matches = registry.filter((item) => item.name === expected.name);
    if (matches.length !== 1) {
      throw new Error(`Kernel foundation manifest must contain exactly one ${expected.name}, found ${matches.length}.`);
    }
    const item = matches[0]!;
    if (
      item.version !== expected.version ||
      item.integrity !== expected.integrity ||
      item.shasum !== expected.shasum ||
      typeof item.tarballFile !== "string"
    ) {
      throw new Error(`Kernel foundation manifest identity mismatch for ${expected.name}@${expected.version}.`);
    }
    if (path.basename(item.tarballFile) !== item.tarballFile) {
      throw new Error(`Kernel foundation manifest contains an unsafe tarball filename for ${expected.name}.`);
    }
    const tarballPath = path.join(artifactDirectory, "packages", item.tarballFile);
    const bytes = await readFile(tarballPath);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const shasum = createHash("sha1").update(bytes).digest("hex");
    if (integrity !== expected.integrity || shasum !== expected.shasum) {
      throw new Error(`Kernel foundation tarball bytes do not match the manifest identity for ${expected.name}@${expected.version}.`);
    }
    resolved.set(expected.name, { ...expected, tarballPath });
  }
  return resolved;
}
