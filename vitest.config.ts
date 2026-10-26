import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // apps/** was missing, so anything tested in the web layer silently never
    // ran. Only pure modules there are worth testing under the node
    // environment — lib/format.ts and its neighbours, not components.
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/**/lib/*.test.ts"],
    environment: "node",
  },
});
