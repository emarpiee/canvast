import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Heavy exact-arithmetic tests share the machine with ~25 parallel workers; 5 s timed out under that load.
    testTimeout: 30_000,
  },
});
