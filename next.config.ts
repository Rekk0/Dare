import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * PGlite 必须排除在服务端打包之外。
   *
   * 它是编译成 WASM 的 Postgres，Turbopack 打包会破坏 WASM 的实例化逻辑，
   * 运行时报 `TypeError: h.instantiateWasm is not a function`。
   * 这个错误只在真起服务器时出现：单元测试直接 import 源码不经过打包，
   * pnpm build 也只做类型检查和编译，都发现不了。
   *
   * postgres（postgres-js）同理放进来，原生驱动不该被打包器改写。
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
