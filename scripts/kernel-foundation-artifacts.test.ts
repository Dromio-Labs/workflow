import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { loadKernelFoundationArtifacts } from "./kernel-foundation-artifacts.js";
import { kernelFoundationPackages } from "./package-closure.js";
import { prepareKernelFoundationArtifacts } from "./prepare-kernel-foundation-artifacts.js";

describe("Kernel foundation artifacts", () => {
  test("prepares the foundation before every release workflow action", async () => {
    const workflow = await Bun.file(
      new URL("../.github/workflows/release.yml", import.meta.url),
    ).text();
    const jobs = [
      ["rehearse", "release-rehearse"],
      ["publish-next", "release-publish-next"],
      ["verify-next", "release-verify-next"],
      ["repair-next-tags", "release-repair-next-tags"],
      ["promote-latest", "release-promote-latest"],
    ] as const;

    for (const [job, releaseCommand] of jobs) {
      const start = workflow.indexOf(`  ${job}:\n`);
      const laterStarts = jobs
        .map(([candidate]) => workflow.indexOf(`  ${candidate}:\n`))
        .filter((candidateStart) => candidateStart > start);
      const end = laterStarts.length > 0 ? Math.min(...laterStarts) : workflow.length;
      const jobDefinition = workflow.slice(start, end);
      const setup = jobDefinition.indexOf("- run: make setup");
      const prepare = jobDefinition.indexOf("- run: make release-prepare-foundation");
      const release = jobDefinition.indexOf(`- run: make ${releaseCommand}`);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(setup).toBeGreaterThanOrEqual(0);
      expect(prepare).toBeGreaterThan(setup);
      expect(release).toBeGreaterThan(prepare);
    }
    expect(workflow.match(/- run: make release-prepare-foundation/g)).toHaveLength(jobs.length);
  });

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

  test("rejects missing and extra manifest artifacts before trusting tarballs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-foundation-shape-"));
    try {
      await mkdir(path.join(root, "packages"));
      await writeFile(path.join(root, "package-registry-manifest.json"), "[]");
      await expect(loadKernelFoundationArtifacts(root)).rejects.toThrow(
        "must contain exactly 8 artifacts, found 0",
      );

      await writeFile(
        path.join(root, "package-registry-manifest.json"),
        JSON.stringify([...kernelFoundationPackages, { name: "@unexpected/package" }]),
      );
      await expect(loadKernelFoundationArtifacts(root)).rejects.toThrow(
        "must contain exactly 8 artifacts, found 9",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects registry metadata that differs from the committed release identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-foundation-metadata-"));
    const expected = kernelFoundationPackages[0]!;
    const fakeFetch = (async () => new Response(JSON.stringify({
      dist: {
        integrity: expected.integrity,
        shasum: expected.shasum,
        tarball: `https://registry.npmjs.org/${expected.name}/-/artifact.tgz`,
      },
      name: expected.name,
      version: "999.0.0",
    }))) as typeof fetch;
    try {
      await expect(prepareKernelFoundationArtifacts({
        fetch: fakeFetch,
        outputDirectory: root,
      })).rejects.toThrow("Registry metadata identity mismatch");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("refuses a broad output directory before deleting or downloading anything", async () => {
    let fetched = false;
    const fakeFetch = (async () => {
      fetched = true;
      return new Response();
    }) as typeof fetch;

    await expect(prepareKernelFoundationArtifacts({
      fetch: fakeFetch,
      outputDirectory: path.parse(process.cwd()).root,
    })).rejects.toThrow("must be an isolated child");
    expect(fetched).toBe(false);
  });

  test("rejects tampered downloaded bytes even when registry metadata claims the exact identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-foundation-download-"));
    const expected = kernelFoundationPackages[0]!;
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          dist: {
            integrity: expected.integrity,
            shasum: expected.shasum,
            tarball: "https://registry.npmjs.org/@dromio/chat-shell-ui/-/chat-shell-ui-0.2.0.tgz",
          },
          name: expected.name,
          version: expected.version,
        }));
      }
      return new Response("tampered tarball");
    }) as typeof fetch;
    try {
      await expect(prepareKernelFoundationArtifacts({
        fetch: fakeFetch,
        outputDirectory: root,
      })).rejects.toThrow("Downloaded tarball bytes do not match");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
