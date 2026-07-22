#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { packageDirectories } from "./package-closure.js";
import { assertPackedPackageRuntimePayload } from "./package-payload.js";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, ".tmp", "package-release", "artifacts");
const packageDir = path.join(outDir, "packages");
const stageDir = path.join(outDir, "staging");

await rm(outDir, { force: true, recursive: true });
await mkdir(packageDir, { recursive: true });
await mkdir(stageDir, { recursive: true });

const manifests = new Map<string, PackageManifest>();
for (const directory of packageDirectories) {
  const manifest = await readManifest(
    path.join(root, directory, "package.json"),
  );
  manifests.set(manifest.name, manifest);
}

const registry = [];
for (const directory of packageDirectories) {
  run("bun", ["run", "build"], path.join(root, directory));
}
for (const directory of packageDirectories) {
  const source = path.join(root, directory);
  const stage = path.join(stageDir, directory.replaceAll("/", "-"));
  await cp(source, stage, {
    recursive: true,
    filter: (entry) => !/(?:^|\/)node_modules(?:\/|$)/.test(entry),
  });
  await cp(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
  const packageJsonPath = path.join(stage, "package.json");
  const manifest = await readManifest(packageJsonPath);
  rewriteWorkspaceVersions(manifest, manifests);
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run(
    "bun",
    ["pm", "pack", "--destination", packageDir, "--ignore-scripts"],
    stage,
  );
}

for (const tarballFile of (await readdir(packageDir))
  .filter((entry) => entry.endsWith(".tgz"))
  .sort()) {
  const tarballPath = path.join(packageDir, tarballFile);
  const bytes = await readFile(tarballPath);
  const packageJson = JSON.parse(
    capture("tar", ["-xOf", tarballPath, "package/package.json"], root),
  ) as PackageManifest;
  const packedPaths = capture("tar", ["-tzf", tarballPath], root)
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  assertPackedPackageRuntimePayload(packageJson, packedPaths);
  registry.push({
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    name: packageJson.name,
    packageJson,
    shasum: createHash("sha1").update(bytes).digest("hex"),
    tarballFile,
    version: packageJson.version,
  });
}

await writeFile(
  path.join(outDir, "package-registry-manifest.json"),
  `${JSON.stringify(registry, null, 2)}\n`,
);
console.log(`Built ${registry.length} workflow package artifacts in ${outDir}`);

interface PackageManifest {
  bin?: string | Record<string, string>;
  exports?: unknown;
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

async function readManifest(file: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(file, "utf8")) as PackageManifest;
}

function rewriteWorkspaceVersions(
  manifest: PackageManifest,
  versions: Map<string, PackageManifest>,
): void {
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      if (!value.startsWith("workspace:")) continue;
      const dependency = versions.get(name);
      if (!dependency)
        throw new Error(
          `${manifest.name} references unknown workspace package ${name}`,
        );
      manifest[field]![name] = dependency.version;
    }
  }
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

function capture(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}
