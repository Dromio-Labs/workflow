import {spawn, spawnSync} from "node:child_process";
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertSpawnSucceeded, resolveWorkspaceNodeModulesForDependency} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const dist = path.join(root, "dist");
const rootNodeModules = resolveWorkspaceNodeModulesForDependency(root, "next");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-nextjs-host-run-"));
const tempExamplesRoot = path.join(tempRoot, "examples");
const consumerRoot = path.join(tempExamplesRoot, "nextjs-client-boundary");
const npmCache = path.join(tempRoot, "npm-cache");

let server;

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:nextjs-host-run.");
}

if (!existsSync(path.join(rootNodeModules, "next"))) {
  throw new Error("Next.js is missing from the resolved workspace node_modules. Run bun install before bun run check:package:nextjs-host-run.");
}

try {
  const tarballPath = await packPackage();
  await copyConsumerWorkspace();
  await installConsumer(tarballPath);
  await linkExternalWorkspacePackageResolution();
  await assertInstalledPackageFiles();

  const port = await findFreePort();
  const baseUrl = await startNextDev(port);
  await assertRunnableApp(baseUrl);

  console.log(
    `Next.js installed-package dev-server smoke passed at ${baseUrl}: npm packed @dromio/chat-shell-ui, copied examples/nextjs-client-boundary to a temporary App Router consumer, installed the .tgz plus local file dependencies with npm --offline, launched next dev with webpack, and fetched the rendered app. This proves a local tarball-installed Next.js dev-server run; it does not prove public registry availability, customer cache policy, dependency conflict behavior, or deployed backend behavior.`,
  );
} finally {
  await stopServer();
  await rm(tempRoot, {force: true, recursive: true});
}

async function copyConsumerWorkspace() {
  await mkdir(tempExamplesRoot, {recursive: true});
  await cp(path.join(examplesRoot, "shared"), path.join(tempExamplesRoot, "shared"), {recursive: true});
  await cp(path.join(examplesRoot, "global.d.ts"), path.join(tempExamplesRoot, "global.d.ts"));
  await cp(path.join(examplesRoot, "tsconfig.example.json"), path.join(tempExamplesRoot, "tsconfig.example.json"));
  await cp(path.join(examplesRoot, "tsconfig.json"), path.join(tempExamplesRoot, "tsconfig.json"));
  await cp(path.join(examplesRoot, "nextjs-client-boundary"), consumerRoot, {recursive: true});

  await writeFile(
    path.join(consumerRoot, "next.config.mjs"),
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
          ...localDependencySpecs([
            "next",
            "@next/env",
            "@next/swc-darwin-arm64",
            "@swc/helpers",
            "baseline-browser-mapping",
            "caniuse-lite",
            "postcss",
            "styled-jsx",
            "react",
            "react-dom",
            "react-resizable-panels",
            "zod",
          ]),
        },
        devDependencies: {
          ...localDependencySpecs([
            "@types/node",
            "@types/react",
            "@types/react-dom",
            "typescript",
          ]),
        },
      },
      null,
      2,
    ),
  );

  run(
    "npm",
    ["--cache", npmCache, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "install"],
    "Next.js target-host-like offline npm install",
  );
}

async function linkExternalWorkspacePackageResolution() {
  const namespaceRoot = path.join(tempExamplesRoot, "node_modules", "@dromio");
  await mkdir(namespaceRoot, {recursive: true});
  await symlink(
    path.join(consumerRoot, "node_modules", "@dromio", "chat-shell-ui"),
    path.join(namespaceRoot, "chat-shell-ui"),
    "dir",
  );
}

async function assertInstalledPackageFiles() {
  const requiredFiles = ["dist/chat-shell.js", "dist/chat-shell.d.ts", "dist/chat-shell-contracts/v1.js", "dist/styles.css"];

  for (const file of requiredFiles) {
    const installedFile = path.join(consumerRoot, "node_modules", "@dromio", "chat-shell-ui", ...file.split("/"));
    if (!existsSync(installedFile)) {
      throw new Error(`Next.js target-host-like install is missing package artifact: ${file}`);
    }
  }
}

async function startNextDev(port) {
  const nextBin = path.join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  server = spawn(nextBin, ["dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: consumerRoot,
    env: {
      ...process.env,
      BROWSER: "none",
      NEXT_TELEMETRY_DISABLED: "1",
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
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js dev server exited before becoming ready:\n${tail(output)}`);
    }

    try {
      const response = await fetchWithTimeout(baseUrl, 2_000);
      if (response.ok) {
        return baseUrl;
      }
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Timed out waiting for Next.js dev server at ${baseUrl}:\n${tail(output)}`);
}

async function assertRunnableApp(baseUrl) {
  const html = await fetchText(`${baseUrl}/`);

  if (!html.includes("chat-shell") || !html.includes("Conversation")) {
    throw new Error("Next.js dev-server HTML does not look like the rendered ChatShell App Router example.");
  }

  if (!html.includes("/_next/static/") && !html.includes("/_next/")) {
    throw new Error("Next.js dev-server HTML does not include expected Next.js asset references.");
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

function localDependencySpecs(names) {
  return Object.fromEntries(
    names
      .filter((name) => existsSync(path.join(rootNodeModules, ...name.split("/"))))
      .map((name) => [name, `file:${path.join(rootNodeModules, ...name.split("/"))}`]),
  );
}

async function readPackageJsonIfPresent(packageJsonPath) {
  if (!existsSync(packageJsonPath)) {
    return {
      private: true,
      scripts: {
        build: "next build --webpack",
        dev: "next dev --webpack",
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
          reject(new Error("Could not allocate a local TCP port for the Next.js smoke."));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, 10_000);
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

function tail(value, maxLength = 6_000) {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}
