#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  canonicalPackageName,
  packageDirectories,
  selectCanonicalPublishTarget,
} from "./package-closure.js";

type Action = "rehearse" | "publish-next" | "verify-next" | "repair-next-tags" | "promote-latest";
type Manifest = {
  integrity: string;
  name: string;
  packageJson: PackageJson;
  tarballFile: string;
  version: string;
};
type PackageJson = {
  dependencies?: Record<string, string>;
  name: string;
  private?: boolean;
  publishConfig?: { access?: string };
  repository?: { url?: string };
  version: string;
};

const root = path.resolve(import.meta.dir, "..");
const registryAttempts = 24;
const registryRetryDelayMs = 10_000;
const action = process.argv[2] as Action | undefined;
if (!action || !["rehearse", "publish-next", "verify-next", "repair-next-tags", "promote-latest"].includes(action)) {
  throw new Error("Usage: bun scripts/release.ts <rehearse|publish-next|verify-next|repair-next-tags|promote-latest>");
}

if (action === "verify-next") {
  await verifyPublicPackage(`${canonicalPackageName}@next`);
  process.exit(0);
}

if (action !== "rehearse") requireConfirmation(action);

run("bun", ["scripts/build-local-registry.ts"], root);
const artifactDir = path.join(root, ".tmp", "package-release", "artifacts");
const manifest = JSON.parse(
  await readFile(path.join(artifactDir, "package-registry-manifest.json"), "utf8"),
) as Manifest[];
const ordered = validateRelease(manifest);
const publishTargets = selectCanonicalPublishTarget(ordered);

if (action === "rehearse") {
  run("bun", ["run", "--cwd", "packages/sdk", "verify:package"], root, {
    WORKFLOW_RELEASE_ARTIFACT_DIR: path.join(artifactDir, "packages"),
  });
  console.log(`Release rehearsal passed for ${ordered.length} packages: ${ordered.map(item => item.name).join(", ")}`);
  process.exit(0);
}

if (action === "publish-next") {
  for (const item of publishTargets) {
    const publishedIntegrity = npmView(`${item.name}@${item.version}`, "dist.integrity");
    if (publishedIntegrity) {
      if (publishedIntegrity !== item.integrity) {
        throw new Error(`${item.name}@${item.version} already exists with different contents.`);
      }
      console.log(`Already published exact artifact ${item.name}@${item.version}; skipping.`);
      run("npm", ["dist-tag", "add", `${item.name}@${item.version}`, "next"], root);
      continue;
    }
    run("npm", [
      "publish",
      path.join(artifactDir, "packages", item.tarballFile),
      "--access", "public",
      "--tag", "next",
      "--provenance",
    ], root);
  }
  await Promise.all(publishTargets.map(item => waitForNpmVersion(`${item.name}@${item.version}`, item.version)));
  await verifyPublicPackage(`${canonicalPackageName}@next`, publishTargets[0]!.version);
  process.exit(0);
}

if (action === "repair-next-tags") {
  const packagesWithLatest = new Set<string>();
  for (const item of publishTargets) {
    const nextVersion = npmView(`${item.name}@next`, "version");
    const latestVersion = npmView(`${item.name}@latest`, "version");
    if (nextVersion !== item.version || (latestVersion !== undefined && latestVersion !== item.version)) {
      throw new Error(
        `Refusing tag repair for ${item.name}: next=${nextVersion || "nothing"}, ` +
        `latest=${latestVersion || "nothing"}, expected next=${item.version} and latest=${item.version} or nothing.`,
      );
    }
    if (latestVersion === item.version) packagesWithLatest.add(item.name);
  }
  for (const item of publishTargets) {
    if (packagesWithLatest.has(item.name)) run("npm", ["dist-tag", "rm", item.name, "latest"], root);
  }
  for (const item of publishTargets) {
    const nextVersion = npmView(`${item.name}@next`, "version");
    const latestVersion = npmView(`${item.name}@latest`, "version");
    if (nextVersion !== item.version || latestVersion !== undefined) {
      throw new Error(
        `Tag repair verification failed for ${item.name}: next=${nextVersion || "nothing"}, ` +
        `latest=${latestVersion || "nothing"}.`,
      );
    }
  }
  console.log(
    `Removed or confirmed absent the unintended latest tag for ${publishTargets.length} package; next remains unchanged.`,
  );
  process.exit(0);
}

await verifyPublicPackage(`${canonicalPackageName}@next`, publishTargets[0]!.version);
for (const item of publishTargets) {
  const nextVersion = npmView(`${item.name}@next`, "version");
  if (nextVersion !== item.version) {
    throw new Error(`${item.name}@next resolves to ${nextVersion || "nothing"}, expected ${item.version}.`);
  }
}
for (const item of publishTargets) {
  run("npm", ["dist-tag", "add", `${item.name}@${item.version}`, "latest"], root);
}
await verifyPublicPackage(`${canonicalPackageName}@latest`, publishTargets[0]!.version);

function validateRelease(items: Manifest[]): Manifest[] {
  if (items.length !== packageDirectories.length) {
    throw new Error(`Expected ${packageDirectories.length} package artifacts, found ${items.length}.`);
  }
  const byName = new Map(items.map(item => [item.name, item]));
  if (byName.size !== packageDirectories.length || !byName.has(canonicalPackageName)) {
    throw new Error("The release manifest must contain each package exactly once, including @dromio/workflow.");
  }
  for (const item of items) {
    if (item.packageJson.private === true || item.packageJson.publishConfig?.access !== "public") {
      throw new Error(`${item.name} is not configured for public publication.`);
    }
    if (item.packageJson.repository?.url !== "https://github.com/Dromio-Labs/workflow.git") {
      throw new Error(`${item.name} does not point at the standalone public repository.`);
    }
    for (const [dependency, specifier] of Object.entries(item.packageJson.dependencies ?? {})) {
      const local = byName.get(dependency);
      if (local && specifier !== local.version) {
        throw new Error(`${item.name} must depend on exact release version ${dependency}@${local.version}, got ${specifier}.`);
      }
    }
  }
  const ordered: Manifest[] = [];
  const pending = new Map(byName);
  while (pending.size) {
    const ready = [...pending.values()].filter(item =>
      Object.keys(item.packageJson.dependencies ?? {}).every(name => !pending.has(name))
    ).sort((left, right) => left.name.localeCompare(right.name));
    if (!ready.length) throw new Error("The package release closure contains an internal dependency cycle.");
    for (const item of ready) {
      ordered.push(item);
      pending.delete(item.name);
    }
  }
  if (ordered.at(-1)?.name !== canonicalPackageName) {
    throw new Error("@dromio/workflow must be published after its internal dependency closure.");
  }
  return ordered;
}

function requireConfirmation(expected: Exclude<Action, "rehearse" | "verify-next">): void {
  if (process.env.DROMIO_RELEASE_CONFIRM !== expected) {
    throw new Error(`Refusing ${expected}. Set DROMIO_RELEASE_CONFIRM=${expected} in the protected release environment.`);
  }
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error(`${expected} is only allowed from the main branch in GitHub Actions.`);
  }
}

function npmView(specifier: string, field: string): string | undefined {
  const result = spawnSync("npm", ["view", specifier, field, "--json"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    if (/E404|404 Not Found/.test(result.stderr)) return undefined;
    throw new Error(`Unable to query npm for ${specifier}: ${result.stderr.trim() || "unknown npm error"}`);
  }
  const value = JSON.parse(result.stdout || "null") as string | null;
  return typeof value === "string" ? value : undefined;
}

async function verifyPublicPackage(specifier: string, expected?: string): Promise<void> {
  const expectedVersion = await waitForNpmVersion(specifier, expected);
  const dependencySpecifier = expected ?? dependencyValueFor(specifier);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dromio-workflow-public-"));
  const headlessTemporary = await mkdtemp(path.join(os.tmpdir(), "dromio-workflow-public-headless-"));
  try {
    await writeFile(path.join(temporary, "package.json"), JSON.stringify({
      devDependencies: {
        "@types/bun": "1.3.14",
        "@types/node": "24.13.2",
      },
      dependencies: { [canonicalPackageName]: dependencySpecifier, zod: "4.4.3" },
      name: "dromio-workflow-public-verification",
      private: true,
      type: "module",
    }, null, 2));
    await writeFile(path.join(temporary, "workflow.ts"), representativeWorkflowSource());
    await writeFile(path.join(temporary, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
        types: ["bun"],
      },
      include: ["workflow.ts"],
    }, null, 2));
    await installPublicDependencies(temporary);
    await assertInstalledPackageVersion(temporary, expectedVersion);
    run("npm", ["audit", "--omit=dev", "--audit-level=moderate"], temporary);
    run("node", [path.join(temporary, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], temporary);
    run("bun", ["run", "workflow.ts"], temporary);
    await verifyPublicHeadlessPackage(
      dependencySpecifier,
      expectedVersion,
      headlessTemporary,
    );
    console.log(`Verified clean public consumer for ${specifier} with the supported Bun runtime.`);
  } finally {
    await rm(temporary, { force: true, recursive: true });
    await rm(headlessTemporary, { force: true, recursive: true });
  }
}

async function verifyPublicHeadlessPackage(
  dependencySpecifier: string,
  expectedVersion: string,
  cwd: string,
): Promise<void> {
  await mkdir(path.join(cwd, "tmp"), { recursive: true });
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({
    dependencies: { [canonicalPackageName]: dependencySpecifier, zod: "4.4.3" },
    name: "dromio-workflow-public-headless-verification",
    private: true,
    type: "module",
  }, null, 2));
  await writeFile(path.join(cwd, "headless.mjs"), headlessWorkflowSource());
  await installPublicHeadlessDependencies(cwd);
  await assertInstalledPackageVersion(cwd, expectedVersion);
  run("bun", ["headless.mjs"], cwd);
  console.log("Verified no-hoist public package graph without optional integrations.");
}

async function assertInstalledPackageVersion(cwd: string, expectedVersion: string): Promise<void> {
  const installedPackage = JSON.parse(
    await readFile(path.join(cwd, "node_modules", "@dromio", "workflow", "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  if (installedPackage.name !== canonicalPackageName || installedPackage.version !== expectedVersion) {
    throw new Error(
      `Installed ${installedPackage.name || "unknown package"}@${installedPackage.version || "unknown version"}, ` +
      `expected ${canonicalPackageName}@${expectedVersion}.`,
    );
  }
}

function dependencyValueFor(specifier: string): string {
  const prefix = `${canonicalPackageName}@`;
  if (!specifier.startsWith(prefix) || specifier.length === prefix.length) {
    throw new Error(`Expected a ${canonicalPackageName}@<version-or-tag> specifier, got ${specifier}.`);
  }
  return specifier.slice(prefix.length);
}

async function waitForNpmVersion(specifier: string, expected?: string): Promise<string> {
  for (let attempt = 1; attempt <= registryAttempts; attempt += 1) {
    const version = npmView(specifier, "version");
    if (version && (!expected || version === expected)) return version;
    if (attempt < registryAttempts) {
      console.log(
        `Waiting for npm registry propagation for ${specifier}` +
        `${expected ? `=${expected}` : ""} (${attempt}/${registryAttempts})...`,
      );
      await delay(registryRetryDelayMs);
    }
  }
  throw new Error(
    `${specifier} did not resolve${expected ? ` to ${expected}` : ""} after ${registryAttempts} registry checks.`,
  );
}

async function installPublicDependencies(cwd: string): Promise<void> {
  for (let attempt = 1; attempt <= registryAttempts; attempt += 1) {
    const result = spawnSync("npm", ["install", "--ignore-scripts"], { cwd, encoding: "utf8" });
    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return;
    }
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const propagationFailure = /E404|ETARGET|404 Not Found|No matching version/i.test(output);
    if (!propagationFailure || attempt === registryAttempts) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      throw new Error(`npm install --ignore-scripts failed in ${cwd}`);
    }
    console.log(`Waiting for npm dependency propagation (${attempt}/${registryAttempts})...`);
    await delay(registryRetryDelayMs);
  }
}

async function installPublicHeadlessDependencies(cwd: string): Promise<void> {
  const temporary = path.join(cwd, "tmp");
  for (let attempt = 1; attempt <= registryAttempts; attempt += 1) {
    const result = spawnSync("bun", [
      "install",
      "--ignore-scripts",
      "--linker=isolated",
      "--omit=peer",
      "--omit=optional",
      "--no-cache",
    ], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: path.join(cwd, "cache"),
        BUN_TMPDIR: temporary,
        TEMP: temporary,
        TMP: temporary,
        TMPDIR: temporary,
      },
    });
    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return;
    }
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const propagationFailure = /E404|ETARGET|404 Not Found|No matching version/i.test(output);
    if (!propagationFailure || attempt === registryAttempts) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      throw new Error(`isolated bun install failed in ${cwd}`);
    }
    console.log(`Waiting for npm headless dependency propagation (${attempt}/${registryAttempts})...`);
    await delay(registryRetryDelayMs);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function representativeWorkflowSource(): string {
  return `import { step, workflow } from "@dromio/workflow";
import { z } from "zod";

const greet = step({
  id: "greet",
  input: { name: z.string() },
  output: { message: z.string() },
  run: ({ input }) => ({ message: \`Hello, \${input.name}!\` }),
});
const greetingWorkflow = workflow({
  catalog: [greet],
  document: {
    edges: [
      { id: "trigger-to-greet", source: "trigger", target: "greet" },
      { id: "greet-to-end", source: "greet", target: "end" },
    ],
    end: { id: "end", output: { message: { jsonSchema: { type: "string" } } }, type: "result" },
    id: "greeting-workflow",
    nodes: [{ catalogItemId: greet.id, id: "greet" }],
    trigger: { id: "trigger", input: { name: { jsonSchema: { type: "string" } } }, type: "manual" },
    version: 1,
  },
});
const session = await greetingWorkflow.start({ name: "Dromio" });
if (session.status !== "completed" || session.state.message !== "Hello, Dromio!") {
  throw new Error(\`Unexpected workflow result: \${JSON.stringify(session.state)}\`);
}
console.log(session.state.message);
`;
}

function headlessWorkflowSource(): string {
  return `import { artifactRefJsonSchema } from "@dromio/workflow/product";
${representativeWorkflowSource()}
if (artifactRefJsonSchema.type !== "object") {
  throw new Error("Missing product runtime export.");
}
`;
}

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}
