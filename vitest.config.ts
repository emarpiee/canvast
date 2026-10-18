import { defineConfig } from "vitest/config";

export default defineConfig({
  // The build reads .md and .svg files as text (scripts/build.mjs); a unit test that imports a module using them gets the same.
  plugins: [
    {
      name: "text-files",
      enforce: "pre",
      transform(code, id) {
        if (/\.(md|svg)$/.test(id)) return { code: `export default ${JSON.stringify(code)};`, map: null };
        return null;
      },
    },
  ],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Heavy exact-arithmetic tests share the machine with ~25 parallel workers; 5 s timed out under that load.
    testTimeout: 30_000,
  },
});
