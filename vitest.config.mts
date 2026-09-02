import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 跟 tsconfig.json 的 paths 保持一致。vitest 不读 tsconfig 的别名
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // PGlite 每个用例起一个内存库，比纯函数测试慢一个量级
    testTimeout: 30_000,
  },
});
