import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/.next/**", "**/.chrome-profile/**", "**/browser-state/**", "**/dist/**"],
    coverage: { reporter: ["text", "html"] },
  },
});
