import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const npmCache = await mkdtemp(path.join(os.tmpdir(), "chatshell-peer-cache-"));
const reactPeers = ["react", "react-dom"];
const expectedPeerRange = "^18.3.0 || ^19.0.0";
const expectedExternalImports = ["react/jsx-runtime", "react", "react-dom"];

try {
  if (!existsSync(dist)) {
    throw new Error("dist is missing. Run npm run build before npm run check:package:peers.");
  }

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  for (const peerName of reactPeers) {
    if (packageJson.dependencies?.[peerName]) {
      throw new Error(`${peerName} must stay in peerDependencies, not dependencies.`);
    }

    if (packageJson.peerDependencies?.[peerName] !== expectedPeerRange) {
      throw new Error(`${peerName} peer range must be "${expectedPeerRange}".`);
    }
  }

  const viteConfig = await readFile(path.join(root, "vite.lib.config.ts"), "utf8");
  const missingExternalConfig = expectedExternalImports.filter((specifier) => !viteConfig.includes(`"${specifier}"`));
  if (missingExternalConfig.length > 0 || !viteConfig.includes("external:")) {
    throw new Error(`vite.lib.config.ts must externalize React peer imports: ${expectedExternalImports.join(", ")}.`);
  }

  const uiBundle = await readFile(path.join(dist, "chat-shell.js"), "utf8");
  const imports = findStaticImports(uiBundle);
  const missingExternalImports = expectedExternalImports.filter((specifier) => !imports.includes(specifier));

  if (missingExternalImports.length > 0) {
    throw new Error(`dist/chat-shell.js is missing external React imports: ${missingExternalImports.join(", ")}.`);
  }

  const unexpectedReactImports = imports.filter((specifier) => (
    (specifier === "react" || specifier.startsWith("react/") || specifier === "react-dom" || specifier.startsWith("react-dom/")) &&
    !expectedExternalImports.includes(specifier)
  ));

  if (unexpectedReactImports.length > 0) {
    throw new Error(`dist/chat-shell.js contains unexpected React import specifiers: ${unexpectedReactImports.join(", ")}.`);
  }

  assertDoesNotBundleReactRuntime(uiBundle, "dist/chat-shell.js");

  for (const artifact of ["chat-shell-contracts.js", "chat-shell-contracts/v1.js"]) {
    const source = await readFile(path.join(dist, artifact), "utf8");
    const reactImports = findStaticImports(source).filter((specifier) => specifier === "react" || specifier.startsWith("react/") || specifier === "react-dom" || specifier.startsWith("react-dom/"));

    if (reactImports.length > 0) {
      throw new Error(`dist/${artifact} must remain React-free; found ${reactImports.join(", ")}.`);
    }

    assertDoesNotBundleReactRuntime(source, `dist/${artifact}`);
  }

  const pack = spawnSync("npm", ["--cache", npmCache, "pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  if (pack.status !== 0) {
    throw new Error(`npm pack --dry-run failed:\n${pack.stdout}\n${pack.stderr}`);
  }

  const packedFiles = JSON.parse(pack.stdout)[0].files.map((file) => file.path);
  const forbiddenPackedPeerFiles = packedFiles.filter((file) => {
    const normalized = file.toLowerCase();
    return normalized.startsWith("node_modules/") || normalized.includes("/node_modules/") || normalized.includes("react.development") || normalized.includes("react.production");
  });

  if (forbiddenPackedPeerFiles.length > 0) {
    throw new Error(`Packed package must not include React peer/runtime files: ${forbiddenPackedPeerFiles.join(", ")}`);
  }

  console.log("Package peer dependency smoke passed: React stays peer-only, externalized from dist, and absent from packed files.");
} finally {
  await rm(npmCache, {force: true, recursive: true});
}

function findStaticImports(source) {
  const imports = [];
  const pattern = /^import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["'];?/gm;
  let match;

  while ((match = pattern.exec(source))) {
    imports.push(match[1]);
  }

  return imports;
}

function assertDoesNotBundleReactRuntime(source, label) {
  const forbiddenRuntimeMarkers = [
    "__SECRET_INTERNALS_DO_NOT_USE",
    "react.production.min",
    "react.development.js",
    "react-dom.production.min",
    "react-dom.development.js",
  ];
  const found = forbiddenRuntimeMarkers.filter((marker) => source.includes(marker));

  if (found.length > 0) {
    throw new Error(`${label} appears to bundle React runtime markers: ${found.join(", ")}.`);
  }
}
