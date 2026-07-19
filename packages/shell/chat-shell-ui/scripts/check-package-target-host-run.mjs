import {spawn, spawnSync} from "node:child_process";
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  assertSpawnSucceeded,
  localDependencySpec as workspaceLocalDependencySpec,
} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-target-host-run-"));
const consumerRoot = path.join(tempRoot, "basic-render");
const npmCache = path.join(tempRoot, "npm-cache");

let server;

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:target-host-run.");
}

try {
  const tarballPath = await packPackage();
  await copyConsumerWorkspace();
  await installConsumer(tarballPath);
  await assertInstalledPackageFiles();

  const port = await findFreePort();
  const baseUrl = await startVite(port);
  await assertRunnableApp(baseUrl);

  console.log(
    `Target-host installed-package dev-server smoke passed at ${baseUrl}: npm packed @dromio/chat-shell-ui, copied examples/basic-render to a temporary consumer, installed the .tgz plus local file dependencies with npm --offline, launched that consumer's installed Vite dev server, fetched the app HTML/transformed source, and verified Vite served optimized modules from node_modules/@dromio/chat-shell-ui/dist. This proves a local tarball-installed Vite dev-server run; it does not prove public registry availability, customer cache policy, dependency conflict behavior, or a deployed backend.`,
  );
} finally {
  await stopServer();
  await rm(tempRoot, {force: true, recursive: true});
}

async function copyConsumerWorkspace() {
  await cp(path.join(root, "examples", "basic-render"), consumerRoot, {recursive: true});
  await cp(path.join(root, "examples", "shared"), path.join(tempRoot, "shared"), {recursive: true});
  await cp(path.join(root, "examples", "global.d.ts"), path.join(tempRoot, "global.d.ts"));
  await cp(path.join(root, "examples", "tsconfig.example.json"), path.join(tempRoot, "tsconfig.example.json"));
  await cp(path.join(root, "examples", "tsconfig.json"), path.join(tempRoot, "tsconfig.json"));
  await writeFile(
    path.join(tempRoot, "vite.example.config.ts"),
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
}

async function installConsumer(tarballPath) {
  const packageJsonPath = path.join(consumerRoot, "package.json");
  const originalPackageJson = await readPackageJsonIfPresent(packageJsonPath);

  await writeFile(
    packageJsonPath,
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
    "target-host-like offline npm install",
  );
}

async function assertInstalledPackageFiles() {
  const requiredFiles = ["dist/chat-shell.js", "dist/chat-shell.d.ts", "dist/chat-shell-contracts/v1.js", "dist/styles.css"];

  for (const file of requiredFiles) {
    const installedFile = path.join(consumerRoot, "node_modules", "@dromio", "chat-shell-ui", ...file.split("/"));
    if (!existsSync(installedFile)) {
      throw new Error(`Target-host-like install is missing package artifact: ${file}`);
    }
  }
}

async function startVite(port) {
  const viteBin = path.join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  server = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: consumerRoot,
    env: {
      ...process.env,
      BROWSER: "none",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite dev server exited before becoming ready:\n${output}`);
    }

    try {
      const response = await fetchWithTimeout(baseUrl, 1_000);
      if (response.ok) {
        return baseUrl;
      }
    } catch {
      await sleep(250);
    }
  }

  throw new Error(`Timed out waiting for Vite dev server at ${baseUrl}:\n${output}`);
}

async function assertRunnableApp(baseUrl) {
  const html = await fetchText(`${baseUrl}/`);
  if (!html.includes('id="root"') || !html.includes("/main.tsx")) {
    throw new Error("Dev-server HTML does not look like the copied Vite consumer app.");
  }

  const main = await fetchText(`${baseUrl}/main.tsx`);
  if (!main.includes("/App.tsx") || !main.includes("react-dom_client")) {
    throw new Error("Transformed main.tsx does not include the expected app and React client imports.");
  }

  const app = await fetchText(`${baseUrl}/App.tsx`);
  const packageModulePath = app.match(/\/node_modules\/\.vite\/deps\/@chat-shell_ui(?:_[^"']+)?\.js[^"']*/)?.[0];
  if (!packageModulePath) {
    throw new Error("Transformed App.tsx did not import an optimized @dromio/chat-shell-ui module from node_modules.");
  }

  const packageModule = await fetchText(`${baseUrl}${packageModulePath}`);
  if (!packageModule.includes("node_modules/@dromio/chat-shell-ui/dist/chat-shell.js")) {
    throw new Error("Optimized @dromio/chat-shell-ui module did not resolve from the installed package dist entry.");
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
        dev: "vite",
        typecheck: "tsc --noEmit -p tsconfig.json",
      },
      type: "module",
    };
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a local TCP port for the Vite smoke."));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, 5_000);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}\n${body.slice(0, 2_000)}`);
  }

  return response.text();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");

  await Promise.race([
    exited,
    sleep(2_000),
  ]);

  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await exited;
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: consumerRoot,
    encoding: "utf8",
  });

  assertSpawnSucceeded(result, label);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
