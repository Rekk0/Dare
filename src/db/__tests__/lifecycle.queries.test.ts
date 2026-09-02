import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../client";
import { assignments } from "../schema";
import { advanceActivity, findAdvanceable, performAssignment } from "../queries/lifecycle";

/**
 * 幂等性测试。
 *
 * scheduler 每 30s 扫一次，进程可能重启、可能有多个实例，
 * 同一次推进随时可能被触发两次。**重复分配和重复发钱是最不能出的两种错。**
 */

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

const HOUR = 3600_000;

async function seedActivity(
  client: PGlite,
  opts: { status: string; playerCount: number; spectatorCount?: number; startOffsetMs?: number },
) {
  const now = Date.now();
  const start = now + (opts.startOffsetMs ?? HOUR);
  const n = opts.playerCount + (opts.spectatorCount ?? 0);

  const users = Array.from({ length: n }, (_, i) => `('u${i}','昵称${i}','h${i}','r${i}')`).join(",");
  const parts = Array.from({ length: n }, (_, i) => `('p${i}','act1','u${i}')`).join(",");
  // 只有前 playerCount 个人出了题，其余是旁观者
  const taskRows = Array.from(
    { length: opts.playerCount },
    (_, i) => `('t${i}','act1','p${i}','任务${i}','accepted')`,
  ).join(",");

  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES ${users};
    INSERT INTO activities (id, code, creator_id, title, scene_type, start_at, end_at, vote_deadline, share_desc, status)
      VALUES ('act1','ABC123','u0','周五 KTV','ktv',
              to_timestamp(${start / 1000}),
              to_timestamp(${(start + HOUR) / 1000}),
              to_timestamp(${(start + 2 * HOUR) / 1000}),
              '一首歌点唱权', '${opts.status}');
    INSERT INTO participants (id, activity_id, user_id) VALUES ${parts};
    ${taskRows ? `INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES ${taskRows};` : ""}
  `);
}

beforeEach(async () => {
  const mem = await createMemoryDb();
  db = mem.db;
  client = mem.client;
  close = mem.close;
});

afterEach(async () => {
  await close();
});

async function listAssignments() {
  return db.select().from(assignments);
}

describe("分配的幂等性", () => {
  beforeEach(async () => {
    await seedActivity(client, { status: "locked", playerCount: 5 });
  });

  it("并发跑 5 次只产生一套 assignments", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => performAssignment(db, "act1")),
    );
    // 只有一个实例真的写入了
    expect(results.filter(Boolean)).toHaveLength(1);

    const rows = await listAssignments();
    expect(rows).toHaveLength(5);
  });

  it("串行重复调用同样只写一次", async () => {
    expect(await performAssignment(db, "act1")).toBe(true);
    expect(await performAssignment(db, "act1")).toBe(false);
    expect(await performAssignment(db, "act1")).toBe(false);
    expect(await listAssignments()).toHaveLength(5);
  });

  it("分配结果是 derangement：无人拿到自己出的题", async () => {
    await performAssignment(db, "act1");
    const rows = await listAssignments();
    for (const r of rows) {
      // 任务 tN 的作者是 pN，所以 taskId 的编号不能等于 assigneePid 的编号
      const taskNo = r.taskId.replace("t", "");
      const pidNo = r.assigneePid.replace("p", "");
      expect(taskNo).not.toBe(pidNo);
    }
    // 双射：每道题、每个人各出现一次
    expect(new Set(rows.map((r) => r.taskId)).size).toBe(5);
    expect(new Set(rows.map((r) => r.assigneePid)).size).toBe(5);
  });
});

describe("旁观者", () => {
  it("没出题的人不进分配，但仍是参与者", async () => {
    await seedActivity(client, { status: "locked", playerCount: 4, spectatorCount: 2 });
    expect(await performAssignment(db, "act1")).toBe(true);

    const rows = await listAssignments();
    // 6 个参与者，只有 4 个领到任务
    expect(rows).toHaveLength(4);
    const assignees = new Set(rows.map((r) => r.assigneePid));
    expect(assignees.has("p4")).toBe(false);
    expect(assignees.has("p5")).toBe(false);
  });

  it("出题人数不足 3 人时分配失败，活动停在 locked 可以重试", async () => {
    await seedActivity(client, { status: "locked", playerCount: 2, spectatorCount: 5 });
    await expect(performAssignment(db, "act1")).rejects.toThrow(/不足 3 人/);

    // 事务回滚，一条 assignment 都没写
    expect(await listAssignments()).toHaveLength(0);
    const r = await db.execute<{ status: string }>(
      `SELECT status FROM activities WHERE id = 'act1'`,
    );
    expect(r.rows[0].status).toBe("locked");
  });
});

describe("advanceActivity", () => {
  it("未到开始时间不推进", async () => {
    await seedActivity(client, { status: "recruiting", playerCount: 4 });
    const r = await advanceActivity(db, "act1", new Date());
    expect(r.advanced).toBe(false);
  });

  it("到开始时间从 recruiting 进 locked", async () => {
    await seedActivity(client, { status: "recruiting", playerCount: 4, startOffsetMs: -HOUR });
    const r = await advanceActivity(db, "act1", new Date());
    expect(r).toMatchObject({ advanced: true, from: "recruiting", to: "locked" });
  });

  it("并发推进只有一个成功", async () => {
    await seedActivity(client, { status: "recruiting", playerCount: 4, startOffsetMs: -HOUR });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => advanceActivity(db, "act1", new Date())),
    );
    expect(results.filter((r) => r.advanced)).toHaveLength(1);
  });

  it("一次只推一格，连续调用逐格追上", async () => {
    // 每一格的副作用各走一次独立的幂等事务，不挤在一个大事务里
    await seedActivity(client, { status: "recruiting", playerCount: 4, startOffsetMs: -5 * HOUR });
    const now = new Date();
    const path: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await advanceActivity(db, "act1", now);
      if (!r.advanced) break;
      path.push(`${r.from}->${r.to}`);
    }
    expect(path).toEqual([
      "recruiting->locked",
      "locked->running",
      "running->voting",
      "voting->settled",
    ]);
    expect(await listAssignments()).toHaveLength(4);
  });

  it("不存在的活动返回 false 而不是抛错", async () => {
    const r = await advanceActivity(db, "nope", new Date());
    expect(r).toMatchObject({ advanced: false, reason: "活动不存在" });
  });
});

describe("findAdvanceable", () => {
  it("只捞出真的需要推进的活动", async () => {
    await seedActivity(client, { status: "recruiting", playerCount: 4 });
    // 未到开始时间，不该被捞出来
    expect(await findAdvanceable(db, new Date())).toEqual([]);

    // 时间到了就该捞出来
    const later = new Date(Date.now() + 2 * HOUR);
    expect(await findAdvanceable(db, later)).toEqual(["act1"]);
  });

  it("locked 状态无论什么时间都要捞出来", async () => {
    // locked 是瞬时状态，卡在这里说明上次分配没走完，必须尽快重试
    await seedActivity(client, { status: "locked", playerCount: 4 });
    expect(await findAdvanceable(db, new Date())).toEqual(["act1"]);
  });
});
