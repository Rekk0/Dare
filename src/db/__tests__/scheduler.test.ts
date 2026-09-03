import { describe, expect, it, vi } from "vitest";
import { runSchedulerRound } from "../../../scripts/scheduler";

describe("scheduler 单轮扫描", () => {
  it("一个活动失败时其余活动照常推进", async () => {
    const advanceActivity = vi.fn(async (activityId: string) => {
      if (activityId === "bad") throw new Error("损坏数据");
      return { advanced: true };
    });
    const error = vi.fn();

    const result = await runSchedulerRound({
      findAdvanceable: async () => ["ok-1", "bad", "ok-2"],
      advanceActivity,
      sweepEvidenceReports: async () => [],
      log: vi.fn(),
      error,
    }, new Date("2026-09-03T00:00:00.000Z"));

    expect(advanceActivity).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 3, advanced: 2, failed: 1 });
  });

  it("扫描到空列表时不报错", async () => {
    const log = vi.fn();
    const result = await runSchedulerRound({
      findAdvanceable: async () => [],
      advanceActivity: vi.fn(),
      sweepEvidenceReports: async () => [],
      log,
      error: vi.fn(),
    }, new Date("2026-09-03T00:00:00.000Z"));

    expect(result).toEqual({ scanned: 0, advanced: 0, failed: 0 });
    expect(log).toHaveBeenCalledWith("本轮完成：扫描到 0 个，推进了 0 个，失败 0 个");
  });

  it("推进计数只统计实际推进的活动", async () => {
    const result = await runSchedulerRound({
      findAdvanceable: async () => ["advanced", "unchanged", "failed"],
      advanceActivity: async (activityId) => {
        if (activityId === "failed") throw new Error("推进失败");
        return { advanced: activityId === "advanced" };
      },
      sweepEvidenceReports: async () => [],
      log: vi.fn(),
      error: vi.fn(),
    }, new Date("2026-09-03T00:00:00.000Z"));

    expect(result).toEqual({ scanned: 3, advanced: 1, failed: 1 });
  });
});

describe("补跑证据评审", () => {
  it("每轮都会补跑一次，并把补了几局记进日志", async () => {
    // 评审只在 running -> voting 那一瞬间跑一次，
    // 进程正好在中途重启的话，剩下的 assignment 永远没有报告
    const log = vi.fn();
    const sweepEvidenceReports = vi.fn().mockResolvedValue(["act-1", "act-2"]);
    await runSchedulerRound({
      findAdvanceable: async () => [],
      advanceActivity: vi.fn(),
      sweepEvidenceReports,
      log,
      error: vi.fn(),
    }, new Date("2026-09-03T00:00:00.000Z"));

    expect(sweepEvidenceReports).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some(([m]) => String(m).includes("补跑了 2 局"))).toBe(true);
  });

  it("没有要补的时候不写日志", async () => {
    const log = vi.fn();
    await runSchedulerRound({
      findAdvanceable: async () => [],
      advanceActivity: vi.fn(),
      sweepEvidenceReports: async () => [],
      log,
      error: vi.fn(),
    }, new Date("2026-09-03T00:00:00.000Z"));

    expect(log.mock.calls.some(([m]) => String(m).includes("补跑"))).toBe(false);
  });
});
