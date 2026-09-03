/**
 * 单进程模式下把 scheduler 跑在 web 进程里。
 *
 * **为什么需要这个**：不配 `DATABASE_URL` 时用 PGlite，而 PGlite 是进程内
 * 单连接的，两个进程不能共享同一个库。这时候独立起 `pnpm scheduler`
 * 会扫到一个空库、永远推进不了任何活动 - 表现就是活动永远停在
 * recruiting，任务卡、上传、猜测、投票、结算一屏都看不到。
 *
 * 配了 `DATABASE_URL` 就不在这里跑：那是多进程部署，
 * scheduler 由 systemd 单独托管，在这里再跑一份会重复推进。
 * 推进本身是幂等的（CAS），重复不会发错钱，但没必要浪费。
 *
 * 实际逻辑在 instrumentation-node.ts，这里只做守卫。**不要把它并回来**：
 * Next 也会把这个文件编到 Edge 运行时，node:fs 和 undici 在那边不存在，
 * 并回来就会在构建时打出一串 "Ecmascript file had an error"。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 构建期也会跑 register()。那时候连库既没意义，调度器还会在构建时
  // 真的推进活动状态。
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DATABASE_URL) return;
  if (process.env.DISABLE_INPROCESS_SCHEDULER === "1") return;

  const { startInProcessScheduler } = await import("./instrumentation-node");
  await startInProcessScheduler();
}
