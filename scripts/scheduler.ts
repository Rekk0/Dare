import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { configureNetwork } from "../src/ai/net";
import { advanceActivity, findAdvanceable, sweepPendingEvidenceReports, type AdvanceResult } from "../src/db/queries/lifecycle";
import { purgeExpiredActivities, type RetentionResult } from "../src/db/queries/retention";
import type { Db } from "../src/db/client";
import { LocalStorage } from "../src/storage/local";
import type { StoragePort } from "../src/storage/types";

const INTERVAL_MS = 30_000;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export interface SchedulerRoundResult {
  scanned: number;
  advanced: number;
  failed: number;
}

export interface SchedulerDependencies {
  findAdvanceable: (now: Date) => Promise<string[]>;
  advanceActivity: (activityId: string, now: Date) => Promise<AdvanceResult>;
  /** 补跑漏掉的证据评审，返回补了哪几局 */
  sweepEvidenceReports: () => Promise<string[]>;
  purgeExpiredActivities?: (now: Date) => Promise<RetentionResult>;
  log: (message: string) => void;
  error: (message: string, error: unknown) => void;
}

/**
 * scheduler 可以安全重启或多开。queries 层用 CAS 保证推进、分配和结算的幂等性，
 * 所以这里不需要额外加锁。
 */
export async function runSchedulerRound(
  dependencies: SchedulerDependencies,
  now: Date,
): Promise<SchedulerRoundResult> {
  const activityIds = await dependencies.findAdvanceable(now);
  let advanced = 0;
  let failed = 0;

  for (const activityId of activityIds) {
    try {
      const result = await dependencies.advanceActivity(activityId, now);
      if (result.advanced) advanced += 1;
    } catch (error) {
      failed += 1;
      dependencies.error(`活动 ${activityId} 推进失败，继续处理下一场`, error);
    }
  }

  // 评审只在推进那一瞬间跑一次，进程在中途重启会漏掉几份，补上
  const swept = await dependencies.sweepEvidenceReports();
  if (swept.length) dependencies.log(`补跑了 ${swept.length} 局的证据评审`);

  const result = { scanned: activityIds.length, advanced, failed };
  dependencies.log(`本轮完成：扫描到 ${result.scanned} 个，推进了 ${result.advanced} 个，失败 ${result.failed} 个`);
  return result;
}

function createDependencies(client: Db): SchedulerDependencies {
  const storage: StoragePort = new LocalStorage();
  return {
    findAdvanceable: (now) => findAdvanceable(client, now),
    advanceActivity: (activityId, now) => advanceActivity(client, activityId, now),
    sweepEvidenceReports: () => sweepPendingEvidenceReports(client),
    purgeExpiredActivities: (now) => purgeExpiredActivities(client, storage, now, Number(process.env.RETENTION_DAYS ?? 7)),
    log: (message) => console.log(`[scheduler] ${message}`),
    error: (message, error) => console.error(`[scheduler] ${message}`, error),
  };
}

/** 按 providers:check 的规则加载本地环境变量，已有环境变量不覆盖。 */
export function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const text = line.trim();
      if (!text || text.startsWith("#")) continue;
      const index = text.indexOf("=");
      if (index < 0) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim();
      if (value && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local 不存在时继续使用当前环境变量。
  }
}

export async function runScheduler(dependencies: SchedulerDependencies): Promise<void> {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resume: (() => void) | undefined;
  let lastRetentionAt = 0;
  const requestStop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    resume?.();
    dependencies.log(`收到 ${signal}，本轮结束后退出`);
  };
  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    while (!stopping) {
      try {
        await runSchedulerRound(dependencies, new Date());
        const now = new Date();
        if (dependencies.purgeExpiredActivities && now.getTime() - lastRetentionAt >= RETENTION_INTERVAL_MS) {
          const result = await dependencies.purgeExpiredActivities(now);
          lastRetentionAt = now.getTime();
          dependencies.log(`清理完成：活动 ${result.purged} 个，文件 ${result.filesDeleted} 个，失败 ${result.failed} 个`);
        }
      } catch (error) {
        dependencies.error("本轮扫描失败，30 秒后重试", error);
      }
      if (!stopping) {
        await new Promise<void>((resolveWait) => {
          resume = () => {
            resume = undefined;
            resolveWait();
          };
          timer = setTimeout(() => {
            timer = undefined;
            resume?.();
          }, INTERVAL_MS);
        });
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    dependencies.log("scheduler 已退出");
  }
}

async function main(): Promise<void> {
  configureNetwork();
  loadEnvLocal();
  const { db } = await import("../src/lib/db");
  await runScheduler(createDependencies(await db));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[scheduler] 启动失败", error);
    process.exitCode = 1;
  });
}
