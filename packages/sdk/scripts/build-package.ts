#!/usr/bin/env bun

import {
  cp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";
import solidTransformPlugin from "@opentui/solid/bun-plugin";

const publicEntrypoints = [
  "src/sdk/index.ts",
  "src/sdk/client/interactions/workflow-app.ts",
  "src/sdk/core/index.ts",
  "src/sdk/workflow-control-plane/index.ts",
  "src/sdk/workflow-control-plane/control-plane.ts",
  "src/sdk/workflow-control-plane/http.ts",
  "src/sdk/workflow-control-plane/mcp.ts",
  "src/sdk/workflow-control-plane/in-memory-signal-store.ts",
  "src/sdk/workflow-control-plane/json-trigger-store.ts",
  "src/sdk/workflow-control-plane/runtime-store-contracts.ts",
  "src/sdk/workflow-control-plane/runtime-store-conformance.ts",
  "src/sdk/workflow-control-plane/sqlite-runtime-store.ts",
  "src/sdk/workflow-control-plane/types.ts",
  "src/sdk/workflow-control-plane/worker.ts",
  "src/sdk/distribution/index.ts",
  "src/sdk/agents/runtime/index.ts",
  "src/sdk/client-surfaces/index.ts",
  "src/sdk/product/index.ts",
  "src/sdk/config/index.ts",
  "src/sdk/tools/surface/index.ts",
  "src/sdk/client/index.ts",
  "src/sdk/client/workflow-field-svg/index.ts",
  "src/sdk/client/workflow-render/index.ts",
  "src/sdk/client/workflow-room/index.ts",
  "src/sdk/client/interactions/workflow-opentui-merman-renderer.ts",
  "src/sdk/client/workflow-tui-test-surface.ts",
  "src/sdk/client/workflow-tui-shell-test-surface.ts",
  "src/sdk/init/workbench.ts",
  "src/sdk/react/index.ts",
];

const distDir = path.resolve("dist");
const workspaceTsc = path.resolve("../../node_modules/typescript/bin/tsc");
const externalPackages = [
  "@dromio/protocols",
  "@dromio/workflow-room-protocol",
];
const externalDromioDependencyPlugin = {
  name: "external-dromio-dependencies",
  setup(builder: Bun.PluginBuilder): void {
    builder.onResolve(
      { filter: /^@dromio\/(?:protocols|workflow-room-protocol)(?:\/.*)?$/ },
      (args) => ({
        external: true,
        path: args.path,
      }),
    );
  },
};
const commonJsTextAssetPlugin = {
  name: "commonjs-text-assets",
  setup(builder: Bun.PluginBuilder): void {
    builder.onResolve(
      { filter: /^@dromio\/chat-shell-ui(?:\/.*)?$/ },
      (args) => ({
        path: Bun.resolveSync(args.path, path.resolve("src/sdk/client/interactions/workflow-app-gui/page.ts")),
      }),
    );
    builder.onLoad({ filter: /styles\.css$/ }, async (args) => ({
      contents: await Bun.file(args.path).text(),
      loader: "text",
    }));
    builder.onLoad({ filter: /workflow-app-(?:gui|svg)\.ts$/ }, async (args) => ({
      contents: (await Bun.file(args.path).text()).replaceAll(
        "fileURLToPath(import.meta.url)",
        "require.resolve(\"@dromio/workflow/client\")",
      ),
      loader: "ts",
    }));
  },
};

const commonJsEntrypoints = [
  "src/sdk/client/index.ts",
  "src/sdk/client/workflow-field-svg/index.ts",
  "src/sdk/client/workflow-render/index.ts",
  "src/sdk/client/workflow-room/index.ts",
  "src/sdk/react/index.ts",
];

await rm(distDir, {
  force: true,
  recursive: true,
});

const build = await Bun.build({
  entrypoints: publicEntrypoints,
  format: "esm",
  outdir: distDir,
  external: externalPackages,
  packages: "external",
  plugins: [externalDromioDependencyPlugin, solidTransformPlugin],
  splitting: true,
  target: "bun",
  tsconfig: "./tsconfig.bundle.json",
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

const convexSafeContractsBuild = await Bun.build({
  entrypoints: [
    "src/sdk/workflow-control-plane/in-memory-signal-store.ts",
    "src/sdk/workflow-control-plane/runtime-store-contracts.ts",
  ],
  format: "esm",
  outdir: distDir,
  packages: "external",
  root: ".",
  splitting: false,
  target: "browser",
  tsconfig: "./tsconfig.bundle.json",
});

if (!convexSafeContractsBuild.success) {
  for (const log of convexSafeContractsBuild.logs) console.error(log);
  process.exit(1);
}

const commonJsBuild = await Bun.build({
  entrypoints: commonJsEntrypoints,
  format: "cjs",
  naming: "[dir]/[name].cjs",
  outdir: path.join(distDir, "cjs"),
  packages: "external",
  plugins: [externalDromioDependencyPlugin, commonJsTextAssetPlugin, solidTransformPlugin],
  root: "src/sdk",
  splitting: false,
  target: "node",
  tsconfig: "./tsconfig.bundle.json",
});

if (!commonJsBuild.success) {
  for (const log of commonJsBuild.logs) console.error(log);
  process.exit(1);
}

await Promise.all([
  cp(
    "src/sdk/client/interactions/workflow-app-gui/activity-json-render.tsx",
    path.join(distDir, "activity-json-render.tsx"),
    { recursive: false },
  ),
  cp(
    "src/sdk/client/interactions/workflow-app-gui/shell-client.tsx",
    path.join(distDir, "workflow-app-gui-shell-client.tsx"),
    { recursive: false },
  ),
  cp(
    "src/sdk/client/interactions/workflow-app-svg/shell-client.tsx",
    path.join(distDir, "workflow-app-svg-shell-client.tsx"),
    { recursive: false },
  ),
]);

run("node", [workspaceTsc, "-p", "tsconfig.package.json"]);
await assertPortableBuild(distDir);

console.log(`Built @dromio/workflow package into ${distDir}`);

async function assertPortableBuild(directory: string): Promise<void> {
  const forbidden = [process.cwd(), ["file:", "", "", ""].join("/")];
  for await (const relativePath of new Bun.Glob("**/*.{js,cjs,mjs,map}").scan({ cwd: directory })) {
    const contents = await Bun.file(path.join(directory, relativePath)).text();
    const matched = forbidden.find((value) => contents.includes(value));
    if (matched) {
      throw new Error(`SDK build is not portable: ${relativePath} contains an absolute build location`);
    }
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
