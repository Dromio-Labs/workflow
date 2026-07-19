import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {resolveWorkspaceBinary} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-public-api-"));

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:api.");
}

try {
  const rootTypes = await readDeclaration("chat-shell.d.ts");
  const contractsTypes = await readDeclaration("chat-shell-contracts.d.ts");
  const v1Types = await readDeclaration("chat-shell-contracts-v1.d.ts");

  assertContainsExports(rootTypes, "root UI declaration", [
    "ChatShell",
    "defineChatShellExtension",
    "defineChatShellRenderers",
    "defineChatShellSidePanelRenderers",
    "defineChatShellSlotRenderers",
    "ChatShellEvent",
    "ChatShellRendererRegistry",
    "ChatShellSidePanelRenderer",
    "ChatShellSidePanelRendererProps",
    "ChatShellSlotRenderer",
    "ChatShellSlotRendererProps",
  ]);
  assertDoesNotExposeForbiddenRootApi(rootTypes, "dist/chat-shell.d.ts");

  if (!contractsTypes.includes('export * from "./chat-shell-contracts-v1.js"')) {
    throw new Error("dist/chat-shell-contracts.d.ts must forward to the current versioned contract declarations.");
  }
  assertContainsExports(v1Types, "v1 contract declaration", [
    "chatShellSchemaVersion",
    "ChatShellManifestSchema",
    "ChatShellManifest",
    "ChatShellRuntime",
    "ChatShellSlotRendererId",
    "ChatShellSidePanelRendererId",
  ]);

  const reachableUiDeclarations = await collectReachableDeclarations("chat-shell.d.ts");
  for (const file of reachableUiDeclarations) {
    if (file.startsWith("contracts/")) {
      continue;
    }

    assertDoesNotExposeForbiddenRootApi(await readDeclaration(file), `dist/${file}`);
  }

  await mkdir(path.join(tempRoot, "node_modules", "@dromio"), {recursive: true});
  await symlink(root, path.join(tempRoot, "node_modules", "@dromio", "chat-shell-ui"), "dir");
  await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({private: true, type: "module"}, null, 2));
  await writeFile(
    path.join(tempRoot, "positive.ts"),
    [
      'import {ChatShell, defineChatShellExtension, defineChatShellRenderers, type ChatShellEvent, type ChatShellRendererRegistry, type ChatShellSidePanelRendererProps, type ChatShellSlotRendererProps} from "@dromio/chat-shell-ui";',
      'import {type ChatShellManifest as ForwardedManifest} from "@dromio/chat-shell-ui/chat-shell-contracts";',
      'import {ChatShellManifestSchema, chatShellSchemaVersion, type ChatShellManifest} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";',
      "",
      "const extension = defineChatShellExtension({id: \"api-check\"});",
      "const renderers: ChatShellRendererRegistry = defineChatShellRenderers({});",
      "const eventType: ChatShellEvent[\"type\"] = \"composer.submit\";",
      "const slotProps = null as unknown as ChatShellSlotRendererProps;",
      "const sidePanelProps = null as unknown as ChatShellSidePanelRendererProps;",
      "const manifest = null as unknown as ChatShellManifest;",
      "const forwarded = manifest as ForwardedManifest;",
      "void ChatShell;",
      "void extension;",
      "void renderers;",
      "void eventType;",
      "void slotProps;",
      "void sidePanelProps;",
      "void ChatShellManifestSchema;",
      "void chatShellSchemaVersion;",
      "void forwarded;",
    ].join("\n"),
  );
  await writeFile(
    path.join(tempRoot, "negative-root-contracts.ts"),
    [
      'import {ChatShellManifestSchema, chatShellSchemaVersion} from "@dromio/chat-shell-ui";',
      "void ChatShellManifestSchema;",
      "void chatShellSchemaVersion;",
    ].join("\n"),
  );
  await writeFile(
    path.join(tempRoot, "negative-demo-api.ts"),
    [
      'import {ChatShellStreamingMode, mockConversation, ChatShellShowcase} from "@dromio/chat-shell-ui";',
      "void ChatShellStreamingMode;",
      "void mockConversation;",
      "void ChatShellShowcase;",
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
      },
      null,
      2,
    ),
  );

  runTypecheckFile("positive.ts", "positive public API import");
  expectTypecheckFailure(
    typecheckFileArgs("negative-root-contracts.ts"),
    "root contract schema import",
    ["ChatShellManifestSchema", "chatShellSchemaVersion"],
  );
  expectTypecheckFailure(
    typecheckFileArgs("negative-demo-api.ts"),
    "demo/mock root import",
    ["ChatShellStreamingMode", "mockConversation", "ChatShellShowcase"],
  );

  console.log(
    `Public API declaration check passed: ${reachableUiDeclarations.length} root UI declaration files scanned, expected public imports typechecked, and root schema/demo imports rejected.`,
  );
} finally {
  await rm(tempRoot, {force: true, recursive: true});
}

async function readDeclaration(file) {
  const fullPath = path.join(dist, file);
  if (!existsSync(fullPath)) {
    throw new Error(`dist is missing expected declaration: ${file}`);
  }

  return readFile(fullPath, "utf8");
}

function assertContainsExports(source, label, names) {
  const missing = names.filter((name) => !source.includes(name));
  if (missing.length > 0) {
    throw new Error(`${label} is missing expected public API names: ${missing.join(", ")}.`);
  }
}

function assertDoesNotExposeForbiddenRootApi(source, label) {
  const forbiddenPatterns = [
    /\bmock[A-Z_]/,
    /\bMock[A-Z_]/,
    /\bshowcase[A-Z_]/,
    /\bShowcase[A-Z_]/,
    /\bdemo[A-Z_]/,
    /\bDemo[A-Z_]/,
    /\bfixture[A-Z_]/,
    /\bFixture[A-Z_]/,
    /\bstreamingMode\b/,
    /\bChatShellStreamingMode\b/,
    /\bChatShellManifestSchema\b/,
    /\bchatShellSchemaVersion\b/,
  ];
  const matches = forbiddenPatterns.filter((pattern) => pattern.test(source)).map(String);

  if (matches.length > 0) {
    throw new Error(`${label} exposes forbidden root UI declaration patterns: ${matches.join(", ")}.`);
  }
}

async function collectReachableDeclarations(entry) {
  const seen = new Set();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) {
      continue;
    }

    seen.add(file);
    const source = await readDeclaration(file);
    for (const specifier of findRelativeDeclarationSpecifiers(source)) {
      const nextFile = resolveDeclarationSpecifier(file, specifier);
      if (nextFile && !seen.has(nextFile)) {
        pending.push(nextFile);
      }
    }
  }

  return [...seen].sort();
}

function findRelativeDeclarationSpecifiers(source) {
  const specifiers = [];
  const importExportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g;
  let match;

  while ((match = importExportPattern.exec(source))) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function resolveDeclarationSpecifier(fromFile, specifier) {
  const fromDirectory = path.dirname(fromFile);
  const normalized = path.normalize(path.join(fromDirectory, specifier)).replaceAll(path.sep, "/");
  const candidates = [`${normalized}.d.ts`, `${normalized}/index.d.ts`];

  return candidates.find((candidate) => existsSync(path.join(dist, candidate)));
}

function runTypecheckFile(file, label) {
  const result = spawnTypeScript(typecheckFileArgs(file));

  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${formatSpawnFailure(result)}`);
  }
}

function typecheckFileArgs(file) {
  return [
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--jsx",
    "react-jsx",
    "--skipLibCheck",
    file,
  ];
}

function expectTypecheckFailure(args, label, expectedOutput) {
  const result = spawnTypeScript(args);

  if (result.error) {
    throw new Error(`${label} could not run:\n${formatSpawnFailure(result)}`);
  }

  if (result.status === 0) {
    throw new Error(`${label} unexpectedly typechecked successfully.`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const missing = expectedOutput.filter((text) => !output.includes(text));
  if (missing.length > 0) {
    throw new Error(`${label} failed for an unexpected reason; missing output markers: ${missing.join(", ")}.\n${output}`);
  }
}

function spawnTypeScript(args) {
  const tsc = resolveWorkspaceBinary(root, "tsc");
  return spawnSync(tsc, args, {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

function formatSpawnFailure(result) {
  if (result.error) {
    return `${result.error.name}: ${result.error.message}`;
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}
