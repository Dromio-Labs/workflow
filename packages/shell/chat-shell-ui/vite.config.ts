import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist-demo",
  },
  resolve: {
    alias: {
      "@chatshell/response-protocol": "/src/packages/chatshell-response-protocol/index.ts",
    },
  },
  plugins: [react()],
});
