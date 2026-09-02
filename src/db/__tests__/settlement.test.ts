import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../client";
import { settleActivity } from "../queries/settlement";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

async function seed(spectators = 0) {
  const now = Date.now();
  const users = Array.from({ length: 4 + spectators }, (_, i) => `('u${i + 1}','玩家${i + 1}','h${i + 1}','r${i + 1}')`).join(",");
  const people = Array.from({ length: 4 + spectators }, (_, i) => `('p${i + 1}','act1','u${i + 1}')`).join(",");
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES ${users};
    INSERT INTO activities (id, code, creator_id, title, scene_type, start_at, end_at, vote_deadline, share_desc, status)
      VALUES ('act1','ABC123','u1','派对','ktv',to_timestamp(${now / 1000}),to_timestamp(${(now + 3600000) / 1000}),to_timestamp(${(now + 7200000) / 1000}),'一份','voting');
    INSERT INTO participants (id, activity_id, user_id) VALUES ${people};
    INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES
      ('t1','act1','p1','任务一','accepted'), ('t2','act1','p2','任务二','accepted');
    INSERT INTO assignments (id, activity_id, task_id, assignee_pid, status) VALUES
      ('a1','act1','t1','p2','assigned'), ('a2','act1','t2','p1','assigned');
  `);
}

beforeEach(async () => {
  const memory = await createMemoryDb();
  db = memory.db;
  client = memory.client;
  close = memory.close;
  await seed();
});

afterEach(async () => close());

describe("settleActivity", () => {
  it("并发结算五次时 payouts 只有一套", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => settleActivity(db, "act1")));
    expect(results.filter((result) => result.settled)).toHaveLength(1);
    const rows = await db.execute<{ count: number }>("SELECT count(*)::int AS count FROM payouts WHERE activity_id = 'act1'");
    expect(rows.rows[0]?.count).toBe(4);
  });

  it("结算写入冲突时事务回滚且活动仍是 voting", async () => {
    await client.exec(`
      INSERT INTO payouts (id, activity_id, participant_id, task_shares, bounty_shares, total_shares)
      VALUES ('old','act1','p1',0,0,0)
    `);
    await expect(settleActivity(db, "act1")).rejects.toThrow();
    const state = await db.execute<{ status: string; settlements: number }>(`
      SELECT (SELECT status FROM activities WHERE id = 'act1') AS status,
             (SELECT count(*)::int FROM settlements) AS settlements
    `);
    expect(state.rows[0]).toMatchObject({ status: "voting", settlements: 0 });
  });

  it("有旁观者时按任务数而不是人数守恒", async () => {
    await close();
    const memory = await createMemoryDb();
    db = memory.db;
    client = memory.client;
    close = memory.close;
    await seed(2);
    await settleActivity(db, "act1");
    const totals = await db.execute<{ paid: string; forfeited: string }>(`
      SELECT (SELECT coalesce(sum(total_shares), 0) FROM payouts) AS paid,
             (SELECT coalesce(sum(forfeited), 0) FROM settlements) AS forfeited
    `);
    expect(Number(totals.rows[0]?.paid) + Number(totals.rows[0]?.forfeited)).toBe(2);
  });

  it("被识破的任务执行者为零，前三名猜中者按梯度分配", async () => {
    await client.exec(`
      INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES ('u5','玩家5','h5','r5');
      INSERT INTO participants (id, activity_id, user_id) VALUES ('p5','act1','u5');
      UPDATE assignments SET status = 'busted' WHERE id = 'a1';
      INSERT INTO guesses (id, activity_id, guesser_pid, target_pid, text, similarity, hit, rank) VALUES
        ('g1','act1','p1','p2','猜中',90,true,1),
        ('g2','act1','p3','p2','猜中',90,true,2),
        ('g3','act1','p4','p2','猜中',90,true,3),
        ('g4','act1','p5','p2','猜中',90,true,4);
    `);
    await settleActivity(db, "act1");
    const payoutRows = await db.execute<{ participant_id: string; total_shares: string }>("SELECT participant_id, total_shares FROM payouts ORDER BY participant_id");
    expect(Object.fromEntries(payoutRows.rows.map((row) => [row.participant_id, Number(row.total_shares)]))).toMatchObject({ p1: 0, p2: 0, p3: 0.5, p4: 0.3, p5: 0.2 });
  });

  it("结算后已发份额加作废份额等于任务数", async () => {
    await settleActivity(db, "act1");
    const totals = await db.execute<{ paid: string; forfeited: string; task_count: number }>(`
      SELECT (SELECT coalesce(sum(total_shares), 0) FROM payouts) AS paid,
             (SELECT coalesce(sum(forfeited), 0) FROM settlements) AS forfeited,
             (SELECT count(*)::int FROM assignments WHERE activity_id = 'act1') AS task_count
    `);
    expect(Number(totals.rows[0]?.paid) + Number(totals.rows[0]?.forfeited)).toBe(totals.rows[0]?.task_count);
  });
});
