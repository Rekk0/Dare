import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../client";
import { VoteConflictError, castVote } from "../queries/votes";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

async function seed(status = "voting", assignmentStatus = "assigned") {
  const now = Date.now();
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES
      ('u1','甲','h1','r1'), ('u2','乙','h2','r2'), ('u3','丙','h3','r3');
    INSERT INTO activities (id, code, creator_id, title, scene_type, start_at, end_at, vote_deadline, share_desc, status)
      VALUES ('act1','ABC123','u1','派对','ktv',to_timestamp(${now / 1000}),to_timestamp(${(now + 3600000) / 1000}),to_timestamp(${(now + 7200000) / 1000}),'一份','${status}');
    INSERT INTO participants (id, activity_id, user_id) VALUES
      ('p1','act1','u1'), ('p2','act1','u2'), ('p3','act1','u3');
    INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES ('t1','act1','p1','任务','accepted');
    INSERT INTO assignments (id, activity_id, task_id, assignee_pid, status) VALUES ('a1','act1','t1','p2','${assignmentStatus}');
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

describe("castVote", () => {
  it("被识破的任务投票被拒", async () => {
    await client.exec("UPDATE assignments SET status = 'busted' WHERE id = 'a1'");
    await expect(castVote(db, { assignmentId: "a1", voterPid: "p3", verdict: "pass" }))
      .rejects.toBeInstanceOf(VoteConflictError);
  });

  it("不能给自己的任务投票", async () => {
    await expect(castVote(db, { assignmentId: "a1", voterPid: "p2", verdict: "pass" }))
      .rejects.toThrow("当前不能投票");
  });

  it("非 voting 阶段投票被拒", async () => {
    await client.exec("UPDATE activities SET status = 'running' WHERE id = 'act1'");
    await expect(castVote(db, { assignmentId: "a1", voterPid: "p3", verdict: "pass" }))
      .rejects.toThrow("当前不能投票");
  });

  it("重复投票更新原记录", async () => {
    await castVote(db, { assignmentId: "a1", voterPid: "p3", verdict: "pass", score: 90 });
    await castVote(db, { assignmentId: "a1", voterPid: "p3", verdict: "fail", comment: "没完成" });
    const result = await db.execute<{ count: number; verdict: string; score: number | null; comment: string | null }>(
      "SELECT count(*)::int AS count, max(verdict) AS verdict, max(score) AS score, max(comment) AS comment FROM votes",
    );
    expect(result.rows[0]).toMatchObject({ count: 1, verdict: "fail", score: null, comment: "没完成" });
  });
});
