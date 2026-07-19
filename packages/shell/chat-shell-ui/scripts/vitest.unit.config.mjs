import react from "@vitejs/plugin-react";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dromio/chat-shell-ui/chat-shell-contracts/v1": path.join(root, "src/chat-shell-contracts-v1.ts"),
      "@dromio/chat-shell-ui/chat-shell-contracts": path.join(root, "src/chat-shell-contracts.ts"),
      "@dromio/chat-shell-ui/chat-shell": path.join(root, "src/chat-shell.ts"),
      "@dromio/chat-shell-ui": path.join(root, "src/chat-shell.ts"),
      "@chatshell/response-protocol": path.join(root, "src/packages/chatshell-response-protocol/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: [path.join(root, "tests/setup.ts")],
  },
});
