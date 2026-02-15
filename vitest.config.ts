import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@family-media-vault/core": path.resolve(
        __dirname,
        "packages/core/src/index.ts"
      ),
      "@family-media-vault/storage": path.resolve(
        __dirname,
        "packages/storage/src/index.ts"
      ),
      "@family-media-vault/jobs": path.resolve(
        __dirname,
        "packages/jobs/src/index.ts"
      )
    }
  },
  test: {
    include: ["packages/**/__tests__/**/*.test.ts"]
  }
});
