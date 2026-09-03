import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../client";
import { submitGuess } from "../queries/guesses";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

async function seed() {
  const now = Date.now();
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES
      ('u1','甲','h1','r1'), ('u2','乙','h2','r2'), ('u3','丙','h3','r3'), ('u4','丁','h4','r4');
    INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc, guess_quota)
      VALUES ('act1','ABC123','u1','派对','ktv', to_timestamp(${(now + 3600000) / 1000}), to_timestamp(${(now + 3600000) / 1000}), to_timestamp(${(now + 7200000) / 1000}), to_timestamp(${(now + 10800000) / 1000}), '一份奖励', 3);
    INSERT INTO participants (id, activity_id, user_id) VALUES
      ('p1','act1','u1'), ('p2','act1','u2'), ('p3','act1','u3'), ('p4','act1','u4');
    INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES
      ('t1','act1','p1','任务一','accepted'), ('t2','act1','p2','任务二','accepted');
    INSERT INTO assignments (id, activity_id, task_id, assignee_pid) VALUES
      ('a1','act1','t1','p2'), ('a2','act1','t2','p1');
  `);
}

function params(overrides: Partial<Parameters<typeof submitGuess>[1]> = {}) {
  return { activityId: "act1", guesserPid: "p3", targetPid: "p2", text: "我猜是任务一", similarity: 80, rationale: "命中", hitThreshold: 75, bountyTiers: [0.5, 0.3, 0.2], ...overrides };
}

beforeEach(async () => {
  const memory = await createMemoryDb();
  db = memory.db;
  client = memory.client;
  close = memory.close;
  await seed();
});

afterEach(async () => close());

describe("submitGuess", () => {
  it("两人并发命中同一目标时名次不重复", async () => {
    const [first, second] = await Promise.all([
      submitGuess(db, params({ guesserPid: "p3" })),
      submitGuess(db, params({ guesserPid: "p4" })),
    ]);
    expect(new Set([first.rank, second.rank])).toEqual(new Set([1, 2]));
  });

  it("自己猜自己会被拒绝", async () => {
    await expect(submitGuess(db, params({ targetPid: "p3" }))).rejects.toThrow("不能猜自己");
  });

  it("出题人猜中自己出的题会作废但消耗配额且不触发 busted", async () => {
    const result = await submitGuess(db, params({ guesserPid: "p1", targetPid: "p2" }));
    expect(result).toEqual({ outcome: "hit", quotaLeft: 2 });
    const state = await db.execute<{ voided: boolean; rank: number | null; status: string }>(`
      SELECT g.voided, g.rank, a.status FROM guesses g JOIN assignments a ON a.activity_id = g.activity_id AND a.assignee_pid = g.target_pid
    `);
    expect(state.rows[0]).toMatchObject({ voided: true, rank: null, status: "assigned" });
  });

  it("配额用尽后拒绝", async () => {
    await submitGuess(db, params({ similarity: 10 }));
    await submitGuess(db, params({ similarity: 10 }));
    await submitGuess(db, params({ similarity: 10 }));
    await expect(submitGuess(db, params({ similarity: 10 }))).rejects.toThrow("猜测配额已用尽");
  });

  it("第一个命中才把 assignment 标为 busted", async () => {
    await submitGuess(db, params({ guesserPid: "p3" }));
    await submitGuess(db, params({ guesserPid: "p4" }));
    const state = await db.execute<{ status: string }>("SELECT status FROM assignments WHERE id = 'a1'");
    expect(state.rows[0].status).toBe("busted");
  });

  it("返回 DTO 不含敏感字段", async () => {
    const result = await submitGuess(db, params());
    expect(Object.keys(result)).not.toContain("rationale");
    expect(Object.keys(result)).not.toContain("similarity");
    expect(Object.keys(result)).not.toContain("guesserPid");
  });
});
