#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadKernelFoundationArtifacts } from "./kernel-foundation-artifacts.js";
import { kernelFoundationPackages } from "./package-closure.js";

type Fetch = typeof fetch;

type RegistryMetadata = {
  readonly dist?: {
    readonly integrity?: unknown;
    readonly shasum?: unknown;
    readonly tarball?: unknown;
  };
  readonly name?: unknown;
  readonly version?: unknown;
};

export type PrepareKernelFoundationOptions = {
  readonly fetch?: Fetch;
  readonly outputDirectory: string;
  readonly registryUrl?: string;
};

const root = path.resolve(import.meta.dir, "..");
const defaultRegistryUrl = "https://registry.npmjs.org/";
const artifactDirectoryVariable = "WORKFLOW_KERNEL_FOUNDATION_ARTIFACT_DIR";

/**
 * Materializes the exact, already-published Kernel foundation. Registry
 * metadata, tarball bytes, and packed package identity must all agree with the
 * immutable release constants before the directory can be used.
 */
export async function prepareKernelFoundationArtifacts(
  options: PrepareKernelFoundationOptions,
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const registryUrl = normalizeRegistryUrl(options.registryUrl ?? defaultRegistryUrl);
  const outputDirectory = path.resolve(options.outputDirectory);
  assertSafeOutputDirectory(outputDirectory);
  const packageDirectory = path.join(outputDirectory, "packages");
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(packageDirectory, { recursive: true });

  const manifest = [];
  for (const expected of kernelFoundationPackages) {
    const metadataUrl = new URL(
      `${encodeURIComponent(expected.name)}/${encodeURIComponent(expected.version)}`,
      registryUrl,
    );
    const metadataResponse = await fetchImpl(metadataUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!metadataResponse.ok) {
      throw new Error(
        `Unable to load registry metadata for ${expected.name}@${expected.version}: HTTP ${metadataResponse.status}.`,
      );
    }
    const metadata = await readRegistryMetadata(metadataResponse, expected.name);
    const tarballUrl = validateRegistryMetadata(metadata, expected, registryUrl);
    const tarballResponse = await fetchImpl(tarballUrl, { redirect: "error" });
    if (!tarballResponse.ok) {
      throw new Error(
        `Unable to download ${expected.name}@${expected.version}: HTTP ${tarballResponse.status}.`,
      );
    }
    const bytes = Buffer.from(await tarballResponse.arrayBuffer());
    assertTarballHashes(bytes, expected);

    const tarballFile = safeTarballFile(expected.name, expected.version);
    const tarballPath = path.join(packageDirectory, tarballFile);
    await writeFile(tarballPath, bytes);
    const packageJson = readPackedPackageJson(tarballPath);
    if (packageJson.name !== expected.name || packageJson.version !== expected.version) {
      throw new Error(
        `Packed package identity mismatch: expected ${expected.name}@${expected.version}, ` +
        `found ${packageJson.name || "unknown"}@${packageJson.version || "unknown"}.`,
      );
    }
    manifest.push({ ...expected, packageJson, tarballFile });
  }

  await writeFile(
    path.join(outputDirectory, "package-registry-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await loadKernelFoundationArtifacts(outputDirectory);
  return outputDirectory;
}

function normalizeRegistryUrl(value: string): URL {
  const registryUrl = new URL(value);
  if (
    registryUrl.username ||
    registryUrl.password ||
    registryUrl.search ||
    registryUrl.hash ||
    !["http:", "https:"].includes(registryUrl.protocol)
  ) {
    throw new Error("Registry URL must be an HTTP(S) origin without credentials, query, or fragment.");
  }
  if (!registryUrl.pathname.endsWith("/")) registryUrl.pathname += "/";
  return registryUrl;
}

function assertSafeOutputDirectory(outputDirectory: string): void {
  const allowedParents = [
    path.join(root, ".tmp"),
    os.tmpdir(),
    "/tmp",
    "/private/tmp",
    process.env.RUNNER_TEMP,
  ].filter((entry): entry is string => Boolean(entry)).map((entry) => path.resolve(entry));
  const isSafeChild = allowedParents.some((parent) => {
    const relative = path.relative(parent, outputDirectory);
    return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  });
  if (!isSafeChild) {
    throw new Error("Foundation output directory must be an isolated child of a recognized temporary directory.");
  }
}

async function readRegistryMetadata(
  response: Response,
  packageName: string,
): Promise<RegistryMetadata> {
  try {
    return await response.json() as RegistryMetadata;
  } catch {
    throw new Error(`Registry returned invalid JSON metadata for ${packageName}.`);
  }
}

function validateRegistryMetadata(
  metadata: RegistryMetadata,
  expected: (typeof kernelFoundationPackages)[number],
  registryUrl: URL,
): URL {
  if (
    metadata.name !== expected.name ||
    metadata.version !== expected.version ||
    metadata.dist?.integrity !== expected.integrity ||
    metadata.dist?.shasum !== expected.shasum ||
    typeof metadata.dist?.tarball !== "string"
  ) {
    throw new Error(`Registry metadata identity mismatch for ${expected.name}@${expected.version}.`);
  }
  const tarballUrl = new URL(metadata.dist.tarball);
  if (
    tarballUrl.username ||
    tarballUrl.password ||
    tarballUrl.search ||
    tarballUrl.hash ||
    tarballUrl.origin !== registryUrl.origin ||
    tarballUrl.protocol !== registryUrl.protocol
  ) {
    throw new Error(`Registry returned an unsafe tarball URL for ${expected.name}@${expected.version}.`);
  }
  return tarballUrl;
}

function assertTarballHashes(
  bytes: Buffer,
  expected: (typeof kernelFoundationPackages)[number],
): void {
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shasum = createHash("sha1").update(bytes).digest("hex");
  if (integrity !== expected.integrity || shasum !== expected.shasum) {
    throw new Error(`Downloaded tarball bytes do not match ${expected.name}@${expected.version}.`);
  }
}

function readPackedPackageJson(tarballPath: string): { name?: string; version?: string } {
  const result = spawnSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Unable to inspect packed package identity: ${result.stderr.trim() || "tar failed"}.`);
  }
  try {
    return JSON.parse(result.stdout) as { name?: string; version?: string };
  } catch {
    throw new Error("Packed package contains invalid package.json.");
  }
}

function safeTarballFile(name: string, version: string): string {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}

async function defaultOutputDirectory(): Promise<string> {
  const parent = process.env.RUNNER_TEMP
    ? path.resolve(process.env.RUNNER_TEMP)
    : path.join(root, ".tmp", "package-release");
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, "kernel-foundation-"));
}

function parseArguments(args: readonly string[]): {
  outputDirectory?: string;
  registryUrl?: string;
} {
  const parsed: { outputDirectory?: string; registryUrl?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--output" && value) {
      parsed.outputDirectory = value;
      index += 1;
    } else if (argument === "--registry" && value) {
      parsed.registryUrl = value;
      index += 1;
    } else {
      throw new Error(
        "Usage: bun scripts/prepare-kernel-foundation-artifacts.ts [--output <directory>] [--registry <url>]",
      );
    }
  }
  return parsed;
}

async function exportArtifactDirectory(outputDirectory: string): Promise<void> {
  if (/[\r\n]/.test(outputDirectory)) {
    throw new Error("Artifact directory may not contain a newline.");
  }
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `${artifactDirectoryVariable}=${outputDirectory}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `artifact-dir=${outputDirectory}\n`);
  }
}

if (import.meta.main) {
  const args = parseArguments(process.argv.slice(2));
  const outputDirectory = args.outputDirectory
    ? path.resolve(args.outputDirectory)
    : await defaultOutputDirectory();
  const prepared = await prepareKernelFoundationArtifacts({
    outputDirectory,
    registryUrl: args.registryUrl,
  });
  await exportArtifactDirectory(prepared);
  console.log(`Prepared ${kernelFoundationPackages.length} exact Kernel foundation artifacts in ${prepared}.`);
}
