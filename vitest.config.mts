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
    /**
     * 默认用 node 环境。jsdom 只给组件测试用。
     *
     * 全局开 jsdom 的话，core/ 和 ai/ 这些纯函数测试也要付 DOM 初始化的代价，
     * 实测占了总耗时的一大半（environment 215s / 总 75s 墙钟）。
     *
     * 组件测试在文件顶部用 `@vitest-environment jsdom` docblock 单独声明。
     * vitest 4 里 environmentMatchGlobs 已经不生效了，docblock 是现在的做法。
     */
    environment: "node",
    /**
     * PGlite 是编译成 WASM 的 Postgres，每个用例的 beforeEach 都要起一个新实例，
     * 比纯函数测试慢一个量级。
     *
     * hookTimeout 必须显式设：默认只有 10 秒，而 db 测试文件并行跑时
     * 多个 PGlite 实例同时启动会互相抢资源，beforeEach 超时表现为
     * 「Hook timed out in 10000ms」，看起来像并发逻辑挂了，其实是资源不够。
     */
    testTimeout: 30_000,
    hookTimeout: 45_000,
    /**
     * 限制并行度。db 测试同时起太多 PGlite 实例是上面那个超时的根因，
     * 限流比一味加长超时更能治本。
     *
     * 用顶层 maxWorkers 而不是 poolOptions：vitest 4 的 InlineConfig
     * 类型里没有 poolOptions，运行时会被忽略但 next build 的 type check 会报错。
     * 注意 tsc --noEmit 和 next build 检查的文件集不同，前者漏掉了这个配置文件。
     */
    maxWorkers: 4,
  },
});
