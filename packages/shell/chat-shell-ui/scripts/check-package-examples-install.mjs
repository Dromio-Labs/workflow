import {spawnSync} from "node:child_process";
import {cp, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  assertSpawnSucceeded,
  localDependencySpec as workspaceLocalDependencySpec,
} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const dist = path.join(root, "dist");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-examples-install-"));
const tempExamplesRoot = path.join(tempRoot, "examples");
const npmCache = path.join(tempRoot, "npm-cache");
const exampleNames = ["basic-render", "renderer-registration"];

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:examples-install.");
}

try {
  const tarballPath = await packPackage();
  await copyExampleWorkspace();

  for (const exampleName of exampleNames) {
    const exampleRoot = path.join(tempExamplesRoot, exampleName);
    const originalPackageJson = await readPackageJsonIfPresent(path.join(exampleRoot, "package.json"));

    await writeFile(
      path.join(exampleRoot, "package.json"),
      JSON.stringify(
        {
          ...originalPackageJson,
          dependencies: {
            "@dromio/chat-shell-ui": `file:${tarballPath}`,
            "@types/react": localDependencySpec("@types/react"),
            "@types/react-dom": localDependencySpec("@types/react-dom"),
            "@vitejs/plugin-react": localDependencySpec("@vitejs/plugin-react"),
            csstype: localDependencySpec("csstype"),
            react: localDependencySpec("react"),
            "react-dom": localDependencySpec("react-dom"),
            "react-resizable-panels": localDependencySpec("react-resizable-panels"),
            scheduler: localDependencySpec("scheduler"),
            typescript: localDependencySpec("typescript"),
            vite: localDependencySpec("vite"),
            zod: localDependencySpec("zod"),
          },
          devDependencies: {},
        },
        null,
        2,
      ),
    );

    run(
      "npm",
      ["--cache", npmCache, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "install"],
      exampleRoot,
      `${exampleName} offline installed-example npm install`,
    );
    await linkParentNodeModules(exampleRoot);
    run("npm", ["run", "typecheck"], exampleRoot, `${exampleName} installed-example typecheck`);
    run("npm", ["run", "build"], exampleRoot, `${exampleName} installed-example Vite build`);
  }

  console.log(
    "Offline installed example smoke passed: npm packed @dromio/chat-shell-ui, copied the basic-render and renderer-registration Vite examples to temporary consumers, installed the tarball plus local file dependencies with npm --offline, then ran each example's typecheck and production build against installed package exports.",
  );
} finally {
  await rm(tempRoot, {force: true, recursive: true});
}

async function linkParentNodeModules(exampleRoot) {
  const parentNodeModules = path.join(tempExamplesRoot, "node_modules");
  await rm(parentNodeModules, {force: true, recursive: true});
  await symlink(path.join(exampleRoot, "node_modules"), parentNodeModules, "dir");
}

async function copyExampleWorkspace() {
  await cp(path.join(examplesRoot, "shared"), path.join(tempExamplesRoot, "shared"), {recursive: true});
  await cp(path.join(examplesRoot, "global.d.ts"), path.join(tempExamplesRoot, "global.d.ts"));
  await cp(path.join(examplesRoot, "tsconfig.example.json"), path.join(tempExamplesRoot, "tsconfig.example.json"));

  await writeFile(
    path.join(tempExamplesRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          allowSyntheticDefaultImports: true,
          baseUrl: ".",
          jsx: "react-jsx",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        exclude: ["**/vite.config.ts", "vite.example.config.ts"],
        include: ["**/*.ts", "**/*.tsx", "global.d.ts"],
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(tempExamplesRoot, "vite.example.config.ts"),
    [
      'import react from "@vitejs/plugin-react";',
      'import {defineConfig, mergeConfig, type UserConfig} from "vite";',
      "",
      "export function defineExampleConfig(config: UserConfig = {}) {",
      "  return mergeConfig(",
      "    defineConfig({",
      "      plugins: [react()],",
      "    }),",
      "    config,",
      "  );",
      "}",
      "",
    ].join("\n"),
  );

  for (const exampleName of exampleNames) {
    await cp(path.join(examplesRoot, exampleName), path.join(tempExamplesRoot, exampleName), {recursive: true});
  }
}

async function packPackage() {
  const result = spawnSync("npm", ["--cache", npmCache, "pack", "--pack-destination", tempRoot, "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stdout}\n${result.stderr}`);
  }

  const payload = JSON.parse(result.stdout);
  const tarball = payload[0]?.filename;
  if (!tarball) {
    throw new Error(`npm pack did not return a tarball filename:\n${result.stdout}`);
  }

  return path.join(tempRoot, tarball);
}

function localDependencySpec(name) {
  return workspaceLocalDependencySpec(root, name);
}

async function readPackageJsonIfPresent(packageJsonPath) {
  if (!existsSync(packageJsonPath)) {
    return {
      private: true,
      scripts: {
        build: "vite build",
        typecheck: "tsc --noEmit -p tsconfig.json",
      },
      type: "module",
    };
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  assertSpawnSucceeded(result, label);
}
