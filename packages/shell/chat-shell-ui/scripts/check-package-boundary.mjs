import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const publicPackageName = "@dromio/chat-shell-ui";

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package.");
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.name !== publicPackageName) {
  throw new Error(`package.json name must be ${publicPackageName}; received ${packageJson.name}.`);
}
if (packageJson.private === true) {
  throw new Error("package.json must not mark the UI package as private.");
}
if (packageJson.license !== "UNLICENSED") {
  throw new Error('Private-beta package license must remain "UNLICENSED" until public license terms are finalized.');
}
if (packageJson.publishConfig?.access !== "restricted") {
  throw new Error('Private-beta package publishConfig.access must remain "restricted".');
}
if (
  typeof packageJson.privateBetaNotice !== "string" ||
  !packageJson.privateBetaNotice.includes("Private beta package") ||
  !packageJson.privateBetaNotice.includes("license") ||
  !packageJson.privateBetaNotice.includes("support") ||
  !packageJson.privateBetaNotice.includes("API stability")
) {
  throw new Error("package.json privateBetaNotice must describe private beta, license, support, and API stability limits.");
}

const releasePolicyPath = path.join(root, "docs/chat-shell/release-policy.md");
if (!existsSync(releasePolicyPath)) {
  throw new Error("docs/chat-shell/release-policy.md must exist while the package is in private beta.");
}
const releasePolicy = await readFile(releasePolicyPath, "utf8");
for (const requiredReleasePolicyText of [
  "Private-Beta Release Policy",
  "UNLICENSED",
  "restricted",
  "Support Expectations",
  "API Stability And Versioned Contracts",
  "Breaking-Change Policy",
  "CSS Export Policy",
  "Peer Dependency Policy",
  "Publish Or Promote Checklist",
]) {
  if (!releasePolicy.includes(requiredReleasePolicyText)) {
    throw new Error(`release-policy.md is missing required private-beta topic: ${requiredReleasePolicyText}`);
  }
}

const accessibilitySignoffPath = path.join(root, "docs/chat-shell/accessibility-signoff.md");
if (!existsSync(accessibilitySignoffPath)) {
  throw new Error("docs/chat-shell/accessibility-signoff.md must exist while accessibility and theme signoff are open release gates.");
}

const accessibilitySignoff = await readFile(accessibilitySignoffPath, "utf8");
for (const requiredAccessibilitySignoffText of [
  "Current status: not signed off",
  "VoiceOver | Safari | macOS",
  "VoiceOver | Chrome | macOS",
  "NVDA | Chrome | Windows",
  "npm run test:unit -- --run tests/unit/chat-shell.interactions.test.tsx",
  "npm run test:e2e -- tests/e2e/chat-shell.accessibility.spec.ts",
  "npm run check:package",
  "`/?variant=streaming`",
  "`/?variant=error`",
  "`/?showcase=1`",
  "`/?demo=byo-backend`",
  "Manual signoff still required.",
  "Buyer-owned renderer evidence required.",
  "Primary VoiceOver/Safari full path passes",
  "Secondary NVDA/Chrome and VoiceOver/Chrome smoke paths pass",
  "Manual assistive-technology signoff has not been performed",
  "Final buyer brand themes have not been manually approved",
]) {
  if (!accessibilitySignoff.includes(requiredAccessibilitySignoffText)) {
    throw new Error(`accessibility-signoff.md is missing required release-gate text: ${requiredAccessibilitySignoffText}`);
  }
}

if (/Current status:\s*signed off/i.test(accessibilitySignoff)) {
  throw new Error("accessibility-signoff.md must not claim signed-off status until manual AT/theme evidence is complete.");
}

const expectedExports = new Set([
  ".",
  "./chat-shell",
  "./chat-shell-contracts",
  "./chat-shell-contracts/v1",
  "./styles.css",
]);
const actualExports = Object.keys(packageJson.exports ?? {});
const unexpectedExports = actualExports.filter((entry) => !expectedExports.has(entry));
const missingExports = [...expectedExports].filter((entry) => !actualExports.includes(entry));
if (missingExports.length > 0 || unexpectedExports.length > 0) {
  throw new Error(
    `package.json exports mismatch. Missing: ${missingExports.join(", ") || "none"}. Unexpected: ${
      unexpectedExports.join(", ") || "none"
    }.`,
  );
}
if (JSON.stringify(packageJson.exports).includes("chat-shell-mock-backend")) {
  throw new Error("package.json exports must not publish chat-shell-mock-backend.");
}
if (packageJson.exports["./chat-shell-contracts/v1"]?.types !== "./dist/chat-shell-contracts-v1.d.ts") {
  throw new Error("Versioned contract export must point at dist/chat-shell-contracts-v1.d.ts.");
}
if (packageJson.exports["./styles.css"] !== "./dist/styles.css") {
  throw new Error("CSS export must point at the built dist/styles.css artifact.");
}

const distFiles = await listFiles(dist);
const forbiddenDistPrefixes = ["assets/", ".vite/", "images/", "public/", "_next/", "demo/", "showcase/"];
const forbiddenDistFiles = distFiles.filter(
  (file) => file === "index.html" || forbiddenDistPrefixes.some((prefix) => file.startsWith(prefix)),
);

if (forbiddenDistFiles.length > 0) {
  throw new Error(`dist contains demo/app artifacts: ${forbiddenDistFiles.join(", ")}`);
}

const forbiddenMockBackendArtifacts = distFiles.filter((file) => {
  const lower = file.toLowerCase();
  return lower.includes("chat-shell-mock-backend") || lower.includes("mockbackend") || lower.includes("mock-backend");
});
if (forbiddenMockBackendArtifacts.length > 0) {
  throw new Error(`dist contains mock backend artifacts: ${forbiddenMockBackendArtifacts.join(", ")}`);
}

for (const file of ["chat-shell.js", "chat-shell.d.ts", "chat-shell-contracts/v1.js", "chat-shell-contracts-v1.d.ts", "styles.css"]) {
  if (!distFiles.includes(file)) {
    throw new Error(`dist is missing expected package artifact: ${file}`);
  }
}

const styles = await readFile(path.join(root, "src/styles.css"), "utf8");
const theme = await readFile(path.join(root, "src/theme.css"), "utf8");
const generatedUtilities = await readFile(path.join(root, ".generated/tailwind.css"), "utf8");
const distStyles = await readFile(path.join(root, "dist/styles.css"), "utf8");
// The package stylesheet must ship generated Tailwind utilities, followed by
// the hand-owned theme/component layer, then structural rules that win same
// specificity cascade conflicts.
if (distStyles !== [generatedUtilities, theme, styles].join("\n")) {
  throw new Error("dist/styles.css must be generated Tailwind CSS + theme.css + styles.css. Run bun run build.");
}
for (const selector of ["html,", "body", "#root", ".v1-stage", ".chat-shell-showcase", ".chat-shell-version-label"]) {
  if (styles.includes(selector)) {
    throw new Error(`src/styles.css still contains demo/page selector: ${selector}`);
  }
}

const coreSourceFiles = (await Promise.all([
  listFiles(path.join(root, "src/components"), "src/components"),
  listFiles(path.join(root, "src/contracts"), "src/contracts"),
  listFiles(path.join(root, "src/runtime"), "src/runtime"),
])).flat();
const packageEntrypoints = ["src/chat-shell.ts", "src/chat-shell-contracts-v1.ts", "src/chat-shell-contracts.ts"];
const forbiddenCoreAssetReferences = [];

for (const file of [...coreSourceFiles, ...packageEntrypoints]) {
  const source = await readFile(path.join(root, file), "utf8");

  if (source.includes("/images/hero-visual")) {
    forbiddenCoreAssetReferences.push(file);
  }
}

if (forbiddenCoreAssetReferences.length > 0) {
  throw new Error(`Core package source references public hero visual assets: ${forbiddenCoreAssetReferences.join(", ")}`);
}

const contracts = await import("@dromio/chat-shell-ui/chat-shell-contracts/v1");
if (contracts.chatShellSchemaVersion !== "chat-shell.v1" || typeof contracts.ChatShellManifestSchema?.parse !== "function") {
  throw new Error("Runtime import for @dromio/chat-shell-ui/chat-shell-contracts/v1 did not expose the v1 contract.");
}

const rootEntry = await import("@dromio/chat-shell-ui");
if ("ChatShellManifestSchema" in rootEntry || "chatShellSchemaVersion" in rootEntry) {
  throw new Error("Root @dromio/chat-shell-ui entry must not re-export contract schemas; use @dromio/chat-shell-ui/chat-shell-contracts/v1.");
}

try {
  await import("@dromio/chat-shell-ui/chat-shell-mock-backend");
  throw new Error("Runtime import for @dromio/chat-shell-ui/chat-shell-mock-backend unexpectedly succeeded.");
} catch (error) {
  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    throw error;
  }
}

const tempRoot = path.join(os.tmpdir(), `chatshell-v8-package-smoke-${process.pid}`);
await rm(tempRoot, {force: true, recursive: true});
await mkdir(path.join(tempRoot, "node_modules", "@dromio"), {recursive: true});
await symlink(root, path.join(tempRoot, "node_modules", "@dromio", "chat-shell-ui"), "dir");
await writeFile(
  path.join(tempRoot, "package.json"),
  JSON.stringify({type: "module", private: true}, null, 2),
);
await writeFile(
  path.join(tempRoot, "smoke.ts"),
  [
    'import {ChatShellManifestSchema, type ChatShellManifest} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";',
    'import type {ChatShellEvent} from "@dromio/chat-shell-ui/chat-shell";',
    "",
    "const menu = (id: string) => ({id, sections: []});",
    "",
    "const manifest = {",
    '  schemaVersion: "chat-shell.v1",',
    "  layout: {",
    "    sidebar: {collapsedWidth: 56, defaultWidth: 260, maxWidth: 360, minWidth: 200},",
    "    sidePanel: {defaultOpen: true, defaultWidth: 320, maxWidth: 520, minWidth: 260},",
    "    statusPanel: {defaultOpen: true},",
    "  },",
    "  registries: {",
    "    chrome: {",
    '      title: "Smoke",',
    '      workspace: "Workspace",',
    '      branch: "main",',
    '      appPicker: menu("app-picker"),',
    '      branchMenu: menu("branch-menu"),',
    '      moreMenu: menu("more-menu"),',
    "      sidePanel: {",
    '        initialSurfaceId: "composer",',
    "        surfaces: [{",
    '          surfaceId: "composer",',
    '          surfaceKind: "composer",',
    '          rendererId: "side-panel.composer",',
    '          label: "Composer",',
    '          icon: "message-plus",',
    '          content: {title: "Composer"},',
    "        }],",
    "      },",
    "    },",
    "    user: {",
    '      avatar: "SM",',
    '      email: "smoke@example.com",',
    '      name: "Smoke",',
    '      settingsMenu: menu("settings-menu"),',
    "    },",
    "    sidebar: {",
    '      tasksTitle: "Tasks",',
    '      archiveToggle: {id: "archive", label: "Archive", icon: "archive"},',
    '      contextMenus: {task: menu("task-menu"), workspace: menu("workspace-menu")},',
    "    },",
    "    status: {",
    '      git: {additions: 0, branch: "main", deletions: 0},',
    '      goal: {status: "active", subtitle: "Smoke", title: "Package smoke"},',
    "      progress: [{id: \"package\", label: \"Package\", status: \"active\"}],",
    "      sections: [{",
    '        id: "summary",',
    '        title: "Summary",',
    "        rows: [{id: \"branch\", kind: \"branch\", label: \"Branch\", value: \"main\"}],",
    "      }],",
    "    },",
    "    composer: {",
    '      placeholder: "Ask",',
    '      model: "smoke-model",',
    '      reasoning: "standard",',
    '      approvalMode: "on-request",',
    '      contextUsage: {ariaLabel: "0% context used"},',
    '      addMenu: menu("add-menu"),',
    '      approvalMenu: menu("approval-menu"),',
    '      modelMenu: menu("model-menu"),',
    '      reasoningMenu: menu("reasoning-menu"),',
    '      speedMenu: menu("speed-menu"),',
    "      promptCommands: {mentionAdd: [], mentionFiles: [], skills: [], slash: []},",
    "    },",
    "    settings: {",
    '      activeSectionId: "general",',
    '      searchPlaceholder: "Search settings",',
    "      navSections: [{id: \"root\", items: [{id: \"general\", icon: \"settings\", label: \"General\"}]}],",
    "      general: {generalRows: [], permissionRows: [], workModes: []},",
    "    },",
    "    navActions: [{id: \"new\", label: \"New\", icon: \"plus\"}],",
    "    layoutSlots: [",
    '      {id: "slot-window", order: 0, region: "windowChrome", rendererId: "shell.window-chrome"},',
    '      {id: "slot-sidebar", order: 1, region: "sidebar", rendererId: "shell.sidebar"},',
    '      {id: "slot-timeline", order: 2, region: "timeline", rendererId: "shell.timeline"},',
    '      {id: "slot-composer", order: 3, region: "composer", rendererId: "shell.composer"},',
    '      {id: "slot-status", order: 4, region: "statusRail", rendererId: "shell.status-rail"},',
    '      {id: "slot-side-panel", order: 5, region: "sidePanel", rendererId: "shell.side-panel"},',
    '      {id: "slot-settings", order: 6, region: "settings", rendererId: "shell.settings"},',
    '      {id: "slot-overlays", order: 7, region: "overlays", rendererId: "shell.overlays.mac-top"},',
    "    ],",
    "  },",
    "  controlPlane: {",
    '    activeThreadId: "thread-1",',
    '    activeWorkspaceId: "workspace-1",',
    "    conversations: [{",
    '      id: "conversation-1",',
    '      threadId: "thread-1",',
    '      branch: "main",',
    "      changes: {additions: 0, deletions: 0},",
    "      goal: {completed: false, subtitle: \"Smoke\", title: \"Package smoke\"},",
    "      progress: [],",
    "    }],",
    "    messageParts: [],",
    "    messages: [],",
    "    threads: [{id: \"thread-1\", conversationId: \"conversation-1\", title: \"Smoke\", workspaceId: \"workspace-1\", active: true}],",
    "    toolCalls: [],",
    "    workspaces: [{id: \"workspace-1\", name: \"Workspace\", threadIds: [\"thread-1\"]}],",
    "  },",
    '  runtime: {conversation: {state: "empty"}},',
    "} satisfies ChatShellManifest;",
    "",
    "const parsed = ChatShellManifestSchema.parse(manifest);",
    "",
    'const eventType: ChatShellEvent["type"] = "composer.submit";',
    "void parsed;",
    "void eventType;",
    "",
  ].join("\n"),
);
await writeFile(
  path.join(tempRoot, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        jsx: "react-jsx",
        skipLibCheck: true,
      },
      include: ["smoke.ts"],
    },
    null,
    2,
  ),
);

// bun's hoisted linker installs binaries at the workspace root, so walk up
// from the package until a node_modules/.bin/tsc is found.
const tscName = process.platform === "win32" ? "tsc.cmd" : "tsc";
let tsc = path.join(root, "node_modules", ".bin", tscName);
for (let dir = root; !existsSync(tsc); ) {
  const parent = path.dirname(dir);
  if (parent === dir) {
    throw new Error("Could not resolve a tsc binary from any node_modules/.bin up the tree.");
  }
  dir = parent;
  tsc = path.join(dir, "node_modules", ".bin", tscName);
}
const typecheck = spawnSync(tsc, ["--noEmit", "-p", tempRoot], {
  cwd: tempRoot,
  encoding: "utf8",
});

await rm(tempRoot, {force: true, recursive: true});

if (typecheck.status !== 0) {
  throw new Error(`Symlinked type consumer failed:\n${typecheck.stdout}\n${typecheck.stderr}`);
}

const rootTypes = await readFile(path.join(root, "dist", "chat-shell.d.ts"), "utf8");
if (rootTypes.includes("ChatShellStreamingMode") || rootTypes.includes("streamingMode")) {
  throw new Error("Root ChatShell declarations must not expose demo streaming mode.");
}
if (rootTypes.includes("ChatShellManifestSchema")) {
  throw new Error("Root ChatShell declarations must not re-export contract schemas.");
}

const nextExampleScript = "check:package:nextjs-example";
if (typeof packageJson.scripts?.[nextExampleScript] !== "string" || !packageJson.scripts?.["check:package"]?.includes(nextExampleScript)) {
  throw new Error(`package.json check:package must include ${nextExampleScript}.`);
}

const nextHostRunScript = "check:package:nextjs-host-run";
if (typeof packageJson.scripts?.[nextHostRunScript] !== "string") {
  throw new Error(`package.json scripts must include explicit localhost smoke ${nextHostRunScript}.`);
}

const peerCheckScript = "check:package:peers";
if (typeof packageJson.scripts?.[peerCheckScript] !== "string" || !packageJson.scripts?.["check:package"]?.includes(peerCheckScript)) {
  throw new Error(`package.json check:package must include ${peerCheckScript}.`);
}

const apiSurfaceScript = "check:package:api-surface";
if (typeof packageJson.scripts?.[apiSurfaceScript] !== "string" || !packageJson.scripts?.["check:package"]?.includes(apiSurfaceScript)) {
  throw new Error(`package.json check:package must include ${apiSurfaceScript}.`);
}

const nextSmokeDocs = [
  "README.md",
  "docs/chat-shell/local-linking.md",
  "docs/chat-shell/release-notes.md",
  "tracker-chat-shell-production.md",
];
const staleNextSmokeClaims = [
  "build the Next.js example",
  "The Next.js example is not built",
  "it is not installed or built by the root smoke check",
];

for (const docPath of nextSmokeDocs) {
  const contents = await readFile(path.join(root, docPath), "utf8");

  if (!contents.includes(nextExampleScript)) {
    throw new Error(`${docPath} must mention ${nextExampleScript} while the Next.js smoke is part of check:package.`);
  }

  for (const staleClaim of staleNextSmokeClaims) {
    if (contents.includes(staleClaim)) {
      throw new Error(`${docPath} still contains stale Next.js smoke claim: "${staleClaim}".`);
    }
  }
}

const nextHostRunDocs = [
  "README.md",
  "docs/chat-shell/local-linking.md",
  "docs/chat-shell/release-notes.md",
  "tracker-chat-shell-production.md",
];

for (const docPath of nextHostRunDocs) {
  const contents = await readFile(path.join(root, docPath), "utf8");

  if (!contents.includes(nextHostRunScript)) {
    throw new Error(`${docPath} must mention ${nextHostRunScript} while the explicit Next.js host-run smoke exists.`);
  }
}

const peerCheckDocs = [
  "README.md",
  "docs/chat-shell/local-linking.md",
  "docs/chat-shell/release-notes.md",
  "tracker-chat-shell-production.md",
];

for (const docPath of peerCheckDocs) {
  const contents = await readFile(path.join(root, docPath), "utf8");

  if (!contents.includes(peerCheckScript)) {
    throw new Error(`${docPath} must mention ${peerCheckScript} while the peer dependency smoke is part of check:package.`);
  }
}

const apiSurfaceDocs = [
  "README.md",
  "docs/chat-shell/README.md",
  "docs/chat-shell/api-surface.md",
  "docs/chat-shell/local-linking.md",
  "docs/chat-shell/release-notes.md",
  "tracker-chat-shell-production.md",
];

for (const docPath of apiSurfaceDocs) {
  const contents = await readFile(path.join(root, docPath), "utf8");

  if (!contents.includes(apiSurfaceScript)) {
    throw new Error(`${docPath} must mention ${apiSurfaceScript} while the API surface snapshot is part of check:package.`);
  }
}

console.log("Package boundary smoke passed.");

async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(dir, entry.name), relative));
    } else {
      files.push(relative);
    }
  }

  return files.sort();
}
