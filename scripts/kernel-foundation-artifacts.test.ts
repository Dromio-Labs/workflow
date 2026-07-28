import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { loadKernelFoundationArtifacts } from "./kernel-foundation-artifacts.js";
import { kernelFoundationPackages } from "./package-closure.js";

describe("Kernel foundation artifacts", () => {
  test("rejects a same-version tarball whose bytes do not match Kernel #41", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-foundation-"));
    try {
      const packages = path.join(root, "packages");
      await mkdir(packages);
      const manifest = await Promise.all(kernelFoundationPackages.map(async (item, index) => {
        const tarballFile = `artifact-${index}.tgz`;
        const bytes = Buffer.from(`not-kernel-${item.name}`);
        await writeFile(path.join(packages, tarballFile), bytes);
        return {
          ...item,
          tarballFile,
        };
      }));
      await writeFile(path.join(root, "package-registry-manifest.json"), JSON.stringify(manifest));
      await expect(loadKernelFoundationArtifacts(root)).rejects.toThrow(
        "Kernel foundation tarball bytes do not match the manifest identity",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
