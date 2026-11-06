import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// One frontend image for all environments: the API space stays relative
// (ADR-007/ADR-010). The backend prefix is never baked into the build.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
