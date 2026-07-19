import {spawnSync} from "node:child_process";
import {cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertSpawnSucceeded, resolveWorkspaceNodeModulesForDependency} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const dist = path.join(root, "dist");
const rootNodeModules = resolveWorkspaceNodeModulesForDependency(root, "next");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-nextjs-example-"));
const tempExamplesRoot = path.join(tempRoot, "examples");
const tempAppRoot = path.join(tempExamplesRoot, "nextjs-client-boundary");
const tempNodeModules = path.join(tempAppRoot, "node_modules");

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:nextjs-example.");
}

if (!existsSync(path.join(rootNodeModules, "next"))) {
  throw new Error("Next.js is missing from the resolved workspace node_modules. Run bun install before bun run check:package:nextjs-example.");
}

try {
  await copyNextExampleWorkspace();
  await linkRootDependencies();
  await linkChatShellPackage();

  run(
    process.execPath,
    [path.join(rootNodeModules, "next", "dist", "bin", "next"), "build", "--webpack"],
    "Next.js client-boundary example build",
  );

  console.log(
    "Next.js example smoke passed: copied examples/nextjs-client-boundary to a temporary app, resolved @dromio/chat-shell-ui through package exports and built dist, then ran next build against the real App Router client boundary.",
  );
} finally {
  await rm(tempRoot, {force: true, recursive: true});
}

async function copyNextExampleWorkspace() {
  await mkdir(tempExamplesRoot, {recursive: true});
  await cp(path.join(examplesRoot, "shared"), path.join(tempExamplesRoot, "shared"), {recursive: true});
  await cp(path.join(examplesRoot, "global.d.ts"), path.join(tempExamplesRoot, "global.d.ts"));
  await cp(path.join(examplesRoot, "tsconfig.example.json"), path.join(tempExamplesRoot, "tsconfig.example.json"));
  await cp(path.join(examplesRoot, "tsconfig.json"), path.join(tempExamplesRoot, "tsconfig.json"));
  await cp(path.join(examplesRoot, "nextjs-client-boundary"), tempAppRoot, {recursive: true});
  await writeFile(
    path.join(tempAppRoot, "package.json"),
    JSON.stringify(
      {
        private: true,
        scripts: {
          build: "next build --webpack",
        },
        type: "module",
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(tempAppRoot, "next.config.mjs"),
    [
      'import path from "node:path";',
      "",
      "const nextConfig = {",
      "  experimental: {",
      "    externalDir: true,",
      "  },",
      "  turbopack: {",
      '    root: path.resolve(process.cwd(), ".."),',
      "  },",
      "};",
      "",
      "export default nextConfig;",
      "",
    ].join("\n"),
  );
}

async function linkRootDependencies() {
  await mkdir(tempNodeModules, {recursive: true});
  const entries = await readdir(rootNodeModules, {withFileTypes: true});

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === "@dromio") {
      continue;
    }

    await symlink(path.join(rootNodeModules, entry.name), path.join(tempNodeModules, entry.name), entry.isDirectory() ? "dir" : "file");
  }

}

async function linkChatShellPackage() {
  for (const nodeModulesRoot of [tempNodeModules, path.join(tempExamplesRoot, "node_modules")]) {
    const namespaceRoot = path.join(nodeModulesRoot, "@dromio");
    await mkdir(namespaceRoot, {recursive: true});
    await symlink(root, path.join(namespaceRoot, "chat-shell-ui"), "dir");
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: tempAppRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
  });

  assertSpawnSucceeded(result, label);
}
