/**
 * 单进程模式下的调度器。**只在 Node 运行时跑。**
 *
 * 必须单独一个文件：Next 会把 instrumentation.ts 同时编到 Edge 运行时，
 * 而这里的 node:fs、node:dns、undici 在 Edge 里都不存在。
 * 官方给的做法就是把 node 专用代码拆出来，在 NEXT_RUNTIME 分支里动态引，
 * 这样它根本不会进 Edge 那份产物。见 next/dist/docs 的 instrumentation 指南。
 */
export async function startInProcessScheduler(): Promise<void> {
const { configureNetwork } = await import("@/ai/net");
const { db } = await import("@/lib/db");
const { findAdvanceable, advanceActivity, sweepPendingEvidenceReports } = await import(
  "@/db/queries/lifecycle"
);

configureNetwork();

const TICK_MS = 15_000;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const client = await db;
    const now = new Date();
    const ids = await findAdvanceable(client, now);
    for (const id of ids) {
      // 单个活动失败不能拖垮整轮
      try {
        const result = await advanceActivity(client, id, now);
        if (result.advanced) {
          console.log(`[scheduler] ${id}: ${result.from} -> ${result.to}`);
        }
      } catch (error) {
        console.error(`[scheduler] ${id} 推进失败:`, error);
      }

      // 评审只在推进那一瞬间跑一次，进程在中途重启会漏掉几份，补上
      const swept = await sweepPendingEvidenceReports(client);
      if (swept.length) console.log(`[scheduler] 补跑了 ${swept.length} 局的证据评审`);
    }
  } catch (error) {
    console.error("[scheduler] 本轮失败:", error);
  } finally {
    running = false;
  }
}

console.log("[scheduler] 单进程模式，调度器跑在 web 进程内");
setInterval(() => void tick(), TICK_MS);
void tick();
}
