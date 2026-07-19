import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    outDir: "dist",
    lib: {
      entry: {
        "chat-shell": "src/chat-shell.ts",
        "chat-shell-contracts": "src/chat-shell-contracts.ts",
        "chat-shell-contracts/v1": "src/chat-shell-contracts-v1.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        banner: (chunk) => chunk.fileName === "chat-shell.js" ? "\"use client\";" : "",
      },
    },
  },
  resolve: {
    alias: {
      "@chatshell/response-protocol": "/src/packages/chatshell-response-protocol/index.ts",
    },
  },
  plugins: [react()],
});
