import { describe, expect, it } from "vitest";
import {
  MAX_PLAYERS,
  TooManyPlayersError,
  assertPlayerCount,
  buildRoster,
  guessQuotaFor,
  MIN_PLAYERS,
  NotEnoughPlayersError,
  nextTransition,
  validateSchedule,
  validatePlayerRange,
  type ActivitySchedule,
} from "../lifecycle";
import type { ActivityStatus } from "../visibility";

const T = (iso: string) => new Date(iso);

const sched = (status: ActivityStatus): ActivitySchedule => ({
  status,
  taskDeadline: T("2026-09-05T19:30:00Z"),
  startAt: T("2026-09-05T20:00:00Z"),
  endAt: T("2026-09-05T23:00:00Z"),
  voteDeadline: T("2026-09-06T02:00:00Z"),
});

const BEFORE = T("2026-09-05T19:00:00Z");
const DURING = T("2026-09-05T21:00:00Z");
const AFTER_END = T("2026-09-05T23:30:00Z");
const AFTER_DEADLINE = T("2026-09-06T03:00:00Z");

describe("nextTransition", () => {
  it("draft 不自动推进，要创建者手动发布", () => {
    expect(nextTransition(sched("draft"), AFTER_DEADLINE)).toMatchObject({ kind: "none" });
  });

  it("到 startAt 才从 recruiting 进 locked", () => {
    expect(nextTransition(sched("recruiting"), BEFORE)).toMatchObject({ kind: "none" });
    expect(nextTransition(sched("recruiting"), DURING)).toMatchObject({
      kind: "advance",
      to: "locked",
      action: "nothing",
    });
  });

  it("locked 是瞬时状态，立刻分配并进 running", () => {
    // 单独设这个状态是为了让「锁定」和「分配」是两个独立的幂等步骤：
    // 分配失败时活动停在 locked 可以重试，而不是卡在 recruiting 被反复触发
    expect(nextTransition(sched("locked"), BEFORE)).toMatchObject({
      kind: "advance",
      to: "assigned",
      action: "assign",
    });
  });

  it("到 endAt 才开投票", () => {
    expect(nextTransition(sched("running"), DURING)).toMatchObject({ kind: "none" });
    expect(nextTransition(sched("running"), AFTER_END)).toMatchObject({
      kind: "advance",
      to: "voting",
      action: "openVoting",
    });
  });

  it("到 voteDeadline 才结算", () => {
    expect(nextTransition(sched("voting"), AFTER_END)).toMatchObject({ kind: "none" });
    expect(nextTransition(sched("voting"), AFTER_DEADLINE)).toMatchObject({
      kind: "advance",
      to: "settled",
      action: "settle",
    });
  });

  it("settled 是终态", () => {
    expect(nextTransition(sched("settled"), AFTER_DEADLINE)).toMatchObject({ kind: "none" });
  });

  it("一次只推进一格，落后多格要靠连续几轮追上", () => {
    // 每一格的副作用（分配、结算）各走一次独立的幂等事务，不挤在一个大事务里
    let status: ActivityStatus = "recruiting";
    const steps: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = nextTransition({ ...sched(status), status }, AFTER_DEADLINE);
      if (t.kind === "none") break;
      steps.push(`${t.from}->${t.to}:${t.action}`);
      status = t.to;
    }
    expect(steps).toEqual([
      "recruiting->locked:nothing",
      "locked->assigned:assign",
      "assigned->running:nothing",
      "running->voting:openVoting",
      "voting->settled:settle",
    ]);
  });
});

describe("validateSchedule", () => {
  const now = T("2026-09-01T00:00:00Z");

  it("正常时间序列通过", () => {
    expect(validateSchedule(sched("draft"), now)).toEqual([]);
  });

  it("开始时间不能在过去", () => {
    const p = validateSchedule(
      { startAt: T("2026-08-01T00:00:00Z"), endAt: T("2026-09-05T23:00:00Z"), voteDeadline: T("2026-09-06T02:00:00Z") },
      now,
    );
    expect(p.map((x) => x.field)).toContain("startAt");
  });

  it("结束必须晚于开始，投票截止必须晚于结束", () => {
    const p = validateSchedule(
      { startAt: T("2026-09-05T20:00:00Z"), endAt: T("2026-09-05T19:00:00Z"), voteDeadline: T("2026-09-05T18:00:00Z") },
      now,
    );
    expect(p.map((x) => x.field)).toEqual(["endAt", "voteDeadline"]);
  });
});

describe("分配名单", () => {
  it("没出题的人变旁观者，不阻塞全场", () => {
    const roster = buildRoster([
      { pid: "a", hasAcceptedTask: true },
      { pid: "b", hasAcceptedTask: true },
      { pid: "c", hasAcceptedTask: false },
      { pid: "d", hasAcceptedTask: true },
    ]);
    expect(roster.players).toEqual(["a", "b", "d"]);
    expect(roster.spectators).toEqual(["c"]);
  });

  it("旁观者导致总人数大于任务数", () => {
    // 这正是守恒的分母必须是任务数而不是人数的原因（不变量 I2）
    const participants = [
      { pid: "a", hasAcceptedTask: true },
      { pid: "b", hasAcceptedTask: true },
      { pid: "c", hasAcceptedTask: true },
      { pid: "spec", hasAcceptedTask: false },
    ];
    const roster = buildRoster(participants);
    expect(participants.length).toBeGreaterThan(roster.players.length);
  });

  it("参与分配的人不足 3 人时拒绝开场", () => {
    // N=2 时唯一解是互换，双方立刻知道对方的题，机制失效
    const roster = buildRoster([
      { pid: "a", hasAcceptedTask: true },
      { pid: "b", hasAcceptedTask: true },
      { pid: "c", hasAcceptedTask: false },
    ]);
    expect(() => assertPlayerCount(roster)).toThrow(NotEnoughPlayersError);
    expect(() => assertPlayerCount(roster)).toThrow(String(MIN_PLAYERS));
  });

  it("刚好 3 人可以开场", () => {
    const roster = buildRoster(
      ["a", "b", "c"].map((pid) => ({ pid, hasAcceptedTask: true })),
    );
    expect(() => assertPlayerCount(roster)).not.toThrow();
  });
});

describe("猜测配额随人数走", () => {
  it("不足 9 人固定 3 次", () => {
    for (const n of [3, 4, 6, 8]) {
      expect(guessQuotaFor(n)).toBe(3);
    }
  });

  it("9 人及以上按人数除以 3 向下取整", () => {
    expect(guessQuotaFor(9)).toBe(3);
    expect(guessQuotaFor(12)).toBe(4);
    expect(guessQuotaFor(20)).toBe(6);
    expect(guessQuotaFor(21)).toBe(7);
  });

  it("在 9 人处曲线连续，不会突然跳变", () => {
    // 8 人给 3 次、9 人也给 3 次，跨过阈值时手感不会突变
    expect(guessQuotaFor(8)).toBe(guessQuotaFor(9));
  });
});

describe("人数上限", () => {
  const roster = (n: number) =>
    buildRoster(Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, hasAcceptedTask: true })));

  it("21 人可以开场", () => {
    expect(() => assertPlayerCount(roster(MAX_PLAYERS))).not.toThrow();
  });

  it("超过 21 人拒绝开场", () => {
    // 再多投票就凑不齐法定人数，公投会全部走 AI 兜底，形同虚设
    expect(() => assertPlayerCount(roster(MAX_PLAYERS + 1))).toThrow(TooManyPlayersError);
  });

  it("不足 3 人仍然拒绝", () => {
    expect(() => assertPlayerCount(roster(2))).toThrow(NotEnoughPlayersError);
  });
});

describe("每局人数范围", () => {
  it("3 到 21 的边界合法，越界和倒置拒绝", () => {
    expect(validatePlayerRange(3, 21)).toEqual({ minPlayers: 3, maxPlayers: 21 });
    expect(() => validatePlayerRange(2, 21)).toThrow();
    expect(() => validatePlayerRange(3, 22)).toThrow();
    expect(() => validatePlayerRange(8, 7)).toThrow();
  });
});

describe("validateSchedule 对没填的时间", () => {
  const now = new Date("2026-09-04T00:00:00Z");
  const ok = {
    taskDeadline: new Date("2026-09-04T01:00:00Z"),
    startAt: new Date("2026-09-04T02:00:00Z"),
    endAt: new Date("2026-09-04T04:00:00Z"),
    voteDeadline: new Date("2026-09-04T05:00:00Z"),
  };

  it("正常的时间线没有问题", () => {
    expect(validateSchedule(ok, now)).toEqual([]);
  });

  it("非法日期被挡下来，不会静默通过", () => {
    // Invalid Date 参与比较全是 false，不显式挡的话空表单反而能过校验，
    // 然后死在数据库那层，报出来的错跟时间没有关系
    const problems = validateSchedule({ ...ok, startAt: new Date("") }, now);

    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("startAt");
    expect(problems[0].message).toContain("开始时间");
  });

  it("几个时间都没填时一次全报出来", () => {
    const problems = validateSchedule(
      { ...ok, endAt: new Date(""), voteDeadline: new Date("乱填的") },
      now,
    );

    expect(problems.map((p) => p.field).sort()).toEqual(["endAt", "voteDeadline"]);
  });
});
