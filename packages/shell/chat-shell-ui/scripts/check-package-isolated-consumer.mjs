import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  assertSpawnSucceeded,
  localDependencySpec as workspaceLocalDependencySpec,
  resolveWorkspaceBinary,
} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatshell-isolated-consumer-"));
const consumerRoot = path.join(tempRoot, "consumer");
const npmCache = path.join(tempRoot, "npm-cache");

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:consumer.");
}

try {
  const tarballPath = await packPackage();
  await mkdir(path.join(consumerRoot, "src"), {recursive: true});
  await writeFile(
    path.join(consumerRoot, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: {
          build: "vite build",
          typecheck: "tsc --noEmit -p tsconfig.json",
        },
        dependencies: {
          "@dromio/chat-shell-ui": `file:${tarballPath}`,
          "@types/react": localDependencySpec("@types/react"),
          "@types/react-dom": localDependencySpec("@types/react-dom"),
          csstype: localDependencySpec("csstype"),
          react: localDependencySpec("react"),
          "react-dom": localDependencySpec("react-dom"),
          "react-resizable-panels": localDependencySpec("react-resizable-panels"),
          scheduler: localDependencySpec("scheduler"),
          zod: localDependencySpec("zod"),
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(consumerRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          skipLibCheck: true,
          noEmit: true,
          types: ["react", "react-dom"],
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );
  run(
    "npm",
    ["--cache", npmCache, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "install"],
    "offline tarball consumer install",
  );

  for (const file of ["dist/chat-shell.js", "dist/chat-shell.d.ts", "dist/chat-shell-contracts/v1.js", "dist/chat-shell-contracts-v1.d.ts", "dist/styles.css"]) {
    const installedFile = path.join(consumerRoot, "node_modules", "@dromio", "chat-shell-ui", ...file.split("/"));
    if (!existsSync(installedFile)) {
      throw new Error(`Offline tarball consumer install is missing package artifact: ${file}`);
    }
  }

  await writeFile(
    path.join(consumerRoot, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  await writeFile(
    path.join(consumerRoot, "src", "main.tsx"),
    [
      'import React from "react";',
      'import {createRoot} from "react-dom/client";',
      'import {ChatShell, defineChatShellExtension, type ChatShellEvent} from "@dromio/chat-shell-ui";',
      'import {ChatShellManifestSchema, chatShellSchemaVersion, type ChatShellManifest} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";',
      'import "@dromio/chat-shell-ui/styles.css";',
      "",
      "const menu = (id: string) => ({id, sections: []});",
      "",
      "const manifest = {",
      "  schemaVersion: chatShellSchemaVersion,",
      "  layout: {",
      "    sidebar: {collapsedWidth: 56, defaultWidth: 260, maxWidth: 360, minWidth: 200},",
      "    sidePanel: {defaultOpen: true, defaultWidth: 320, maxWidth: 520, minWidth: 260},",
      "    statusPanel: {defaultOpen: true},",
      "  },",
      "  registries: {",
      "    chrome: {",
      '      title: "Isolated consumer",',
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
      '      avatar: "IC",',
      '      email: "consumer@example.com",',
      '      name: "Consumer",',
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
      '      progress: [{id: "package", label: "Package", status: "active"}],',
      "      sections: [{",
      '        id: "summary",',
      '        title: "Summary",',
      '        rows: [{id: "branch", kind: "branch", label: "Branch", value: "main"}],',
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
      '      navSections: [{id: "root", items: [{id: "general", icon: "settings", label: "General"}]}],',
      "      general: {generalRows: [], permissionRows: [], workModes: []},",
      "    },",
      '    navActions: [{id: "new", label: "New", icon: "plus"}],',
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
      '      goal: {completed: false, subtitle: "Smoke", title: "Package smoke"},',
      "      progress: [],",
      "    }],",
      "    messageParts: [],",
      "    messages: [],",
      '    threads: [{id: "thread-1", conversationId: "conversation-1", title: "Smoke", workspaceId: "workspace-1", active: true}],',
      "    toolCalls: [],",
      '    workspaces: [{id: "workspace-1", name: "Workspace", threadIds: ["thread-1"]}],',
      "  },",
      '  runtime: {conversation: {state: "empty"}},',
      "} satisfies ChatShellManifest;",
      "",
      "const parsedManifest = ChatShellManifestSchema.parse(manifest);",
      "const extension = defineChatShellExtension({id: \"consumer-extension\"});",
      "const handleEvent = (event: ChatShellEvent) => {",
      "  void event.type;",
      "};",
      "",
      "createRoot(document.getElementById(\"root\")!).render(",
      "  React.createElement(ChatShell, {manifest: parsedManifest, extensions: extension, onEvent: handleEvent}),",
      ");",
      "",
    ].join("\n"),
  );

  const tsc = resolveWorkspaceBinary(root, "tsc");
  run(tsc, ["--noEmit", "-p", consumerRoot], "isolated consumer typecheck");

  const vite = resolveWorkspaceBinary(root, "vite");
  run(vite, ["build"], "isolated consumer Vite build");

  console.log(
    "Offline tarball consumer smoke passed: npm packed @dromio/chat-shell-ui, installed the .tgz with local file dependencies and npm --offline, typechecked public imports, and built a tiny Vite app. This proves package files/exports work from the tarball without network access; it does not prove registry availability or a target host's dependency cache.",
  );
} finally {
  await rm(tempRoot, {force: true, recursive: true});
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

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: consumerRoot,
    encoding: "utf8",
  });

  assertSpawnSucceeded(result, label);
}
