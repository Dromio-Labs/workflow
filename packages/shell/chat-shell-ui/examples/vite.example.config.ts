import path from "node:path";
import {fileURLToPath} from "node:url";

import react from "@vitejs/plugin-react";
import {defineConfig, mergeConfig, type UserConfig} from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageAliases = [
  {find: /^@chat-shell\/ui$/, replacement: path.join(root, "src/chat-shell.ts")},
  {find: /^@chat-shell\/ui\/chat-shell$/, replacement: path.join(root, "src/chat-shell.ts")},
  {find: /^@chat-shell\/ui\/chat-shell-contracts$/, replacement: path.join(root, "src/chat-shell-contracts.ts")},
  {find: /^@chat-shell\/ui\/chat-shell-contracts\/v1$/, replacement: path.join(root, "src/chat-shell-contracts-v1.ts")},
  {find: /^@chat-shell\/ui\/styles\.css$/, replacement: path.join(root, "src/styles.css")},
  {
    find: /^@chatshell\/response-protocol$/,
    replacement: path.join(root, "src/packages/chatshell-response-protocol/index.ts"),
  },
];

export function defineExampleConfig(config: UserConfig = {}) {
  return mergeConfig(
    defineConfig({
      resolve: {
        alias: packageAliases,
      },
      plugins: [react()],
    }),
    config,
  );
}
