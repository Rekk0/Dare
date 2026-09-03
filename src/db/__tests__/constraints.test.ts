import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryDb, type Db } from "../client";
import { assignments, guesses, settlements, tasks } from "../schema";

/**
 * DB 约束测试。
 *
 * 几条不变量是写进 DB 的，不靠应用层自觉：应用层可以有 bug，
 * 约束不会。这些测试验证约束真的在拦。
 *
 * 用 PGlite 起内存库，每个用例一个，互不污染。
 */

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

// 建一局最小可用的数据：3 个人，各出一题
async function seed(client: PGlite) {
  const now = Date.now();
  // 多条 SQL 必须走 client.exec；db.execute 是预处理语句，一次只能一条
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES
      ('u1','阿栗','h1','r1'), ('u2','老陈','h2','r2'), ('u3','豆子','h3','r3');
    INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc)
      VALUES ('act1','ABC123','u1','周五 KTV','ktv',
              to_timestamp(${(now + 3600_000) / 1000}), to_timestamp(${(now + 3600_000) / 1000}),
              to_timestamp(${(now + 7200_000) / 1000}),
              to_timestamp(${(now + 10800_000) / 1000}),
              '一首歌点唱权');
    INSERT INTO participants (id, activity_id, user_id) VALUES
      ('p1','act1','u1'), ('p2','act1','u2'), ('p3','act1','u3');
    INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES
      ('t1','act1','p1','任务一','accepted'),
      ('t2','act1','p2','任务二','accepted'),
      ('t3','act1','p3','任务三','accepted');
  `);
}

beforeEach(async () => {
  const mem = await createMemoryDb();
  db = mem.db;
  client = mem.client;
  close = mem.close;
  await seed(client);
});

afterEach(async () => {
  await close();
});

describe("settlements 的守恒约束（I1）", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "s1",
    assignmentId: "as1",
    outcome: "busted",
    toAssignee: "0",
    toGuessers: "0.5",
    forfeited: "0.5",
    ...over,
  });

  beforeEach(async () => {
    await db.insert(assignments).values({
      id: "as1",
      activityId: "act1",
      taskId: "t2",
      assigneePid: "p1",
    });
  });

  it("三个份额加起来等于 1 时通过", async () => {
    await expect(db.insert(settlements).values(row({}))).resolves.toBeDefined();
  });

  it("加起来不等于 1 时被 DB 拒绝", async () => {
    // 应用层可以有 bug，约束不会
    await expect(
      db.insert(settlements).values(row({ toGuessers: "0.5", forfeited: "0.3" })),
    ).rejects.toThrow();
  });

  it("加起来超过 1 也被拒绝", async () => {
    await expect(
      db.insert(settlements).values(row({ toAssignee: "1", toGuessers: "0.5", forfeited: "0" })),
    ).rejects.toThrow();
  });
});

describe("assignments 的双射约束（I3）", () => {
  beforeEach(async () => {
    await db.insert(assignments).values({
      id: "as1",
      activityId: "act1",
      taskId: "t2",
      assigneePid: "p1",
    });
  });

  it("同一道题不能分配给两个人", async () => {
    await expect(
      db.insert(assignments).values({
        id: "as2",
        activityId: "act1",
        taskId: "t2",
        assigneePid: "p2",
      }),
    ).rejects.toThrow();
  });

  it("同一个人不能领两道题", async () => {
    await expect(
      db.insert(assignments).values({
        id: "as2",
        activityId: "act1",
        taskId: "t3",
        assigneePid: "p1",
      }),
    ).rejects.toThrow();
  });
});

describe("tasks 一人一题（假设 A1）", () => {
  it("同一个人在同一活动里不能出两道题", async () => {
    await expect(
      db.insert(tasks).values({
        id: "t4",
        activityId: "act1",
        authorPid: "p1",
        content: "又一道",
      }),
    ).rejects.toThrow();
  });
});

describe("guesses 的约束", () => {
  const g = (over: Record<string, unknown>) => ({
    id: "g1",
    activityId: "act1",
    guesserPid: "p1",
    targetPid: "p2",
    text: "我猜是唱歌",
    similarity: 80,
    hit: true,
    ...over,
  });

  it("不能猜自己（最后一道防线，应用层也要拦）", async () => {
    // 明知完不成时猜自己可以把 0 变成 0.5，是真能套利的
    await expect(
      db.insert(guesses).values(g({ targetPid: "p1" })),
    ).rejects.toThrow();
  });

  it("similarity 超出 0-100 被拒绝", async () => {
    await expect(db.insert(guesses).values(g({ similarity: 101 }))).rejects.toThrow();
    await expect(db.insert(guesses).values(g({ id: "g2", similarity: -1 }))).rejects.toThrow();
  });

  it("同一人对同一目标只能占一个有效命中名次（I8）", async () => {
    await db.insert(guesses).values(g({ rank: 1 }));
    await expect(
      db.insert(guesses).values(g({ id: "g2", rank: 2 })),
    ).rejects.toThrow();
  });

  it("未命中的多条不受该唯一索引限制", async () => {
    // 部分唯一索引只管 hit AND NOT voided，猜不中可以猜很多次
    await db.insert(guesses).values(g({ id: "g1", hit: false, similarity: 10, rank: null }));
    await expect(
      db.insert(guesses).values(g({ id: "g2", hit: false, similarity: 20, rank: null })),
    ).resolves.toBeDefined();
  });

  it("作废的命中也不占那个唯一索引", async () => {
    await db.insert(guesses).values(g({ id: "g1", voided: true, rank: null }));
    await expect(
      db.insert(guesses).values(g({ id: "g2", voided: true, rank: null })),
    ).resolves.toBeDefined();
  });
});

describe("activities 的时间顺序约束", () => {
  it("结束早于开始被拒绝", async () => {
    const now = Date.now();
    await expect(
      client.exec(`
        INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc)
        VALUES ('act2','XYZ789','u1','坏活动','ktv',
                to_timestamp(${(now + 7200_000) / 1000}), to_timestamp(${(now + 7200_000) / 1000}),
                to_timestamp(${(now + 3600_000) / 1000}),
                to_timestamp(${(now + 10800_000) / 1000}),
                '奖励')
      `),
    ).rejects.toThrow();
  });
});

describe("默认值", () => {
  it("bountyTiers 默认是 0.5 / 0.3 / 0.2", async () => {
    // PGlite 的 numeric[] 可能返回 JS 数组，也可能返回 Postgres 的字面量
    // 字符串 "{0.500,0.300,0.200}"。两种都要能解，别假设驱动行为。
    const r = await db.execute<{ bounty_tiers: string[] | string }>(
      `SELECT bounty_tiers FROM activities WHERE id = 'act1'`,
    );
    const raw = r.rows[0].bounty_tiers;
    const tiers = (Array.isArray(raw) ? raw : String(raw).replace(/^\{|\}$/g, "").split(","))
      .map(Number);
    expect(tiers).toEqual([0.5, 0.3, 0.2]);
    expect(tiers.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it("guessQuota 默认 3，threshold 默认 75", async () => {
    const r = await db.execute<{ guess_quota: number; guess_threshold: number }>(
      `SELECT guess_quota, guess_threshold FROM activities WHERE id = 'act1'`,
    );
    expect(r.rows[0].guess_quota).toBe(3);
    expect(r.rows[0].guess_threshold).toBe(75);
  });
});
