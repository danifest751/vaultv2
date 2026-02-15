import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@family-media-vault/core": path.resolve(
        __dirname,
        "packages/core/src/index.ts"
      )
    }
  },
  test: {
    include: ["packages/**/__tests__/**/*.test.ts"]
  }
});
