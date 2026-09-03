import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/ai/tasks/evidenceReview", () => ({
  reviewEvidence: vi.fn(),
}));
import { createMemoryDb, type Db } from "../client";
import { aiReports, assignments, evidences } from "../schema";
import { advanceActivity, findAdvanceable, performAssignment, reviewActivityEvidence } from "../queries/lifecycle";
import { reviewEvidence } from "@/ai/tasks/evidenceReview";

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
    INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc, status)
      VALUES ('act1','ABC123','u0','周五 KTV','ktv',
              to_timestamp(${(start - HOUR / 2) / 1000}),
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
      Array.from({ length: 5 }, () => performAssignment(db, "act1", new Date())),
    );
    // 只有一个实例真的写入了
    expect(results.filter(Boolean)).toHaveLength(1);

    const rows = await listAssignments();
    expect(rows).toHaveLength(5);
  });

  it("串行重复调用同样只写一次", async () => {
    expect(await performAssignment(db, "act1", new Date())).toBe(true);
    expect(await performAssignment(db, "act1", new Date())).toBe(false);
    expect(await performAssignment(db, "act1", new Date())).toBe(false);
    expect(await listAssignments()).toHaveLength(5);
  });

  it("分配结果是 derangement：无人拿到自己出的题", async () => {
    await performAssignment(db, "act1", new Date());
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
    expect(await performAssignment(db, "act1", new Date())).toBe(true);

    const rows = await listAssignments();
    // 6 个参与者，只有 4 个领到任务
    expect(rows).toHaveLength(4);
    const assignees = new Set(rows.map((r) => r.assigneePid));
    expect(assignees.has("p4")).toBe(false);
    expect(assignees.has("p5")).toBe(false);
  });

  it("出题人数不足 3 人时分配失败，活动停在 locked 可以重试", async () => {
    await seedActivity(client, { status: "locked", playerCount: 2, spectatorCount: 5 });
    await expect(performAssignment(db, "act1", new Date())).rejects.toThrow(/不足 3 人/);

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
      "locked->assigned",
      "assigned->running",
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

describe("开启投票时的证据评审", () => {
  // 有证据的评审要把 URL 交给厂商去拉，没有 PUBLIC_BASE_URL 就会被跳过。
  // 这一组测的正是评审本身，所以先把它配上
  const savedBaseUrl = process.env.PUBLIC_BASE_URL;
  beforeEach(() => { process.env.PUBLIC_BASE_URL = "https://dare.example"; });
  afterEach(() => {
    if (savedBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = savedBaseUrl;
  });

  async function seedRunningAssignment(withEvidence = false) {
    await seedActivity(client, { status: "running", playerCount: 3, startOffsetMs: -2 * HOUR });
    await client.exec("INSERT INTO assignments (id, activity_id, task_id, assignee_pid) VALUES ('a1','act1','t0','p1')");
    if (withEvidence) {
      await client.exec("INSERT INTO evidences (id, assignment_id, kind, storage_key, mime, bytes) VALUES ('e1','a1','image','e1.jpg','image/jpeg',12)");
    }
  }

  it("没交证据也会写一条报告，重复推进不重复写", async () => {
    await seedRunningAssignment();
    const result = await advanceActivity(db, "act1", new Date());
    expect(result).toMatchObject({ advanced: true, from: "running", to: "voting" });
    expect(await db.select().from(aiReports)).toHaveLength(1);
    expect((await db.select().from(aiReports))[0]?.report).toEqual({ summary: "没有提交证据。" });
    await advanceActivity(db, "act1", new Date());
    expect(await db.select().from(aiReports)).toHaveLength(1);
  });

  it("单份评审失败不挡投票，其余报告照写并标记失败", async () => {
    await seedRunningAssignment(true);
    vi.mocked(reviewEvidence).mockRejectedValueOnce(new Error("mock 失败"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(advanceActivity(db, "act1", new Date())).resolves.toMatchObject({ advanced: true, to: "voting" });
    expect(await db.select().from(aiReports)).toHaveLength(0);
    expect((await db.select().from(evidences))[0]?.processStatus).toBe("failed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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

describe("分配时踢掉没交题的人", () => {
  it("没交题的人被标记出局，交了题的人不受影响", async () => {
    // 出局是这次改动里最有风险的一步：标错人等于把正常玩家踢出局
    await seedActivity(client, { status: "locked", playerCount: 4, spectatorCount: 2 });

    expect(await performAssignment(db, "act1", new Date())).toBe(true);

    const rows = await client.query<{ id: string; eliminated_at: Date | null }>(
      "SELECT id, eliminated_at FROM participants WHERE activity_id = 'act1' ORDER BY id",
    );
    const out = rows.rows.filter((r) => r.eliminated_at !== null).map((r) => r.id);
    const alive = rows.rows.filter((r) => r.eliminated_at === null).map((r) => r.id);

    // seedActivity 里只有前 playerCount 个人出了题
    expect(alive.sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(out.sort()).toEqual(["p4", "p5"]);
  });

  it("出局的人不领任务，分配数等于交了题的人数", async () => {
    await seedActivity(client, { status: "locked", playerCount: 4, spectatorCount: 3 });
    await performAssignment(db, "act1", new Date());

    const rows = await db.select().from(assignments);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => ["p0", "p1", "p2", "p3"].includes(r.assigneePid))).toBe(true);
  });

  it("猜测配额按活着的人算，不把出局的人算进分母", async () => {
    // 9 个人里只有 3 个交了题，配额应该按 3 算（不足 9 人给 3 次），
    // 按 9 算的话会给出 3 次以外的数
    await seedActivity(client, { status: "locked", playerCount: 3, spectatorCount: 6 });
    await performAssignment(db, "act1", new Date());

    const quota = await client.query<{ guess_quota: number }>(
      "SELECT guess_quota FROM activities WHERE id = 'act1'",
    );
    expect(quota.rows[0].guess_quota).toBe(3);
  });

  it("重复分配不会二次踢人，也不会重复写 assignments", async () => {
    await seedActivity(client, { status: "locked", playerCount: 4, spectatorCount: 2 });
    const first = new Date();
    expect(await performAssignment(db, "act1", first)).toBe(true);
    expect(await performAssignment(db, "act1", new Date(first.getTime() + 60_000))).toBe(false);

    expect(await db.select().from(assignments)).toHaveLength(4);
    const stamps = await client.query<{ eliminated_at: Date }>(
      "SELECT eliminated_at FROM participants WHERE activity_id='act1' AND eliminated_at IS NOT NULL",
    );
    expect(stamps.rows).toHaveLength(2);
    for (const row of stamps.rows) {
      expect(new Date(row.eliminated_at).getTime()).toBe(first.getTime());
    }
  });

  it("交题的人不够本局下限时整个事务回滚，没人被踢", async () => {
    // 回滚不干净的话，一次失败的分配会把人踢出去却不给任务
    await seedActivity(client, { status: "locked", playerCount: 2, spectatorCount: 5 });

    await expect(performAssignment(db, "act1", new Date())).rejects.toThrow();

    const rows = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM participants WHERE activity_id='act1' AND eliminated_at IS NOT NULL",
    );
    expect(rows.rows[0].count).toBe(0);
    expect(await db.select().from(assignments)).toHaveLength(0);
    const status = await client.query<{ status: string }>("SELECT status FROM activities WHERE id='act1'");
    expect(status.rows[0].status).toBe("locked");
  });
});

describe("证据评审的前置条件", () => {
  it("没设 PUBLIC_BASE_URL 时跳过带证据的评审，且不写占位报告", async () => {
    // 写占位报告的话，幂等检查会认为已经评过，
    // 等环境变量配好了，真正的评审再也不会发生。
    // 「没交证据」那条不需要 URL，不受影响，照写
    const saved = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    try {
      await seedActivity(client, { status: "locked", playerCount: 3 });
      await performAssignment(db, "act1", new Date());
      const first = (await db.select().from(assignments))[0];
      await client.query(
        "INSERT INTO evidences (id, assignment_id, kind, storage_key, mime, bytes) VALUES ('e1',$1,'image','k/1.png','image/png',100)",
        [first.id],
      );

      await reviewActivityEvidence(db, "act1");

      const reports = await db.select().from(aiReports);
      // 有证据的那条被跳过，没证据的两条照写
      expect(reports).toHaveLength(2);
      expect(reports.some((r) => r.assignmentId === first.id)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = saved;
    }
  });
});
