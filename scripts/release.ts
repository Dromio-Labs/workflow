#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalPackageName, packageDirectories } from "./package-closure.js";

type Action = "rehearse" | "publish-next" | "verify-next" | "promote-latest";
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
const action = process.argv[2] as Action | undefined;
if (!action || !["rehearse", "publish-next", "verify-next", "promote-latest"].includes(action)) {
  throw new Error("Usage: bun scripts/release.ts <rehearse|publish-next|verify-next|promote-latest>");
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

if (action === "rehearse") {
  run("bun", ["run", "--cwd", "packages/sdk", "verify:package"], root, {
    WORKFLOW_RELEASE_ARTIFACT_DIR: path.join(artifactDir, "packages"),
  });
  console.log(`Release rehearsal passed for ${ordered.length} packages: ${ordered.map(item => item.name).join(", ")}`);
  process.exit(0);
}

if (action === "publish-next") {
  for (const item of ordered) {
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
  await verifyPublicPackage(`${canonicalPackageName}@next`);
  process.exit(0);
}

await verifyPublicPackage(`${canonicalPackageName}@next`);
for (const item of ordered) {
  const nextVersion = npmView(`${item.name}@next`, "version");
  if (nextVersion !== item.version) {
    throw new Error(`${item.name}@next resolves to ${nextVersion || "nothing"}, expected ${item.version}.`);
  }
}
for (const item of ordered) {
  run("npm", ["dist-tag", "add", `${item.name}@${item.version}`, "latest"], root);
}
await verifyPublicPackage(`${canonicalPackageName}@latest`);

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

async function verifyPublicPackage(specifier: string): Promise<void> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dromio-workflow-public-"));
  try {
    await writeFile(path.join(temporary, "package.json"), JSON.stringify({
      devDependencies: { "@types/node": "24.13.2", typescript: "5.9.3" },
      dependencies: { "@dromio/workflow": specifier, zod: "4.4.3" },
      name: "dromio-workflow-public-verification",
      private: true,
      type: "module",
    }, null, 2));
    await writeFile(path.join(temporary, "workflow.ts"), representativeWorkflowSource());
    await writeFile(path.join(temporary, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, strict: true, target: "ES2022" },
      include: ["workflow.ts"],
    }, null, 2));
    run("npm", ["install", "--ignore-scripts"], temporary);
    run("node", [path.join(temporary, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], temporary);
    run("node", ["--experimental-strip-types", "workflow.ts"], temporary);
    console.log(`Verified clean public consumer for ${specifier}.`);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
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

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}
