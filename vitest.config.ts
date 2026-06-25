import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    // @ts-expect-error maxForks exists at runtime in vitest 4 but is missing from type defs
    maxForks: 2,
  },
});
