import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      obsidian: new URL("./tests/mocks/obsidian.ts", import.meta.url).pathname,
    },
  },
});
