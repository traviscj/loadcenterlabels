import { defineConfig } from "vitest/config";

// base "./" keeps every asset URL relative so the build works from any subpath
// (tcj.io/loadcenterlabels/), a file:// open, or a saved copy.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: false },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
