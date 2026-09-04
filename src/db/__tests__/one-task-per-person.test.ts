import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { createMemoryDb, type Db } from "../client";
import { tasks } from "../schema";

/**
 * 一人一题，再交一次是覆盖。
 *
 * 「假设 A1：一人一题」是写进 DB 的唯一索引，不靠应用层自觉。
 * 出题接口用 onConflictDoUpdate，所以截止前反复交只会换掉那一行的正文，
 * 并把 updatedAt 刷成最后一次提交的时间。
 *
 * 这里锁住的就是这条：**库里永远只有一行，内容是最后一次交的。**
 */

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

async function seed(client: PGlite) {
  const now = Date.now();
  const at = (offset: number) => `to_timestamp(${(now + offset) / 1000})`;
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES
      ('u1','阿栗','h1','r1'), ('u2','老陈','h2','r2');
    INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc)
      VALUES ('act1','ABC123','u1','周五 KTV','ktv',
              ${at(3600_000)}, ${at(3600_000)}, ${at(7200_000)}, ${at(10800_000)}, '一首歌点唱权');
    INSERT INTO participants (id, activity_id, user_id) VALUES
      ('p1','act1','u1'), ('p2','act1','u2');
  `);
}

// 出题接口写库那一段，原样搬过来
async function submit(content: string, pid = "p1") {
  await db
    .insert(tasks)
    .values({ id: `t-${Math.random()}`, activityId: "act1", authorPid: pid, content, aiReview: null, status: "accepted" })
    .onConflictDoUpdate({
      target: [tasks.activityId, tasks.authorPid],
      set: { content, aiReview: null, status: "accepted", updatedAt: new Date() },
    });
}

async function mine(pid = "p1") {
  return db.select().from(tasks).where(and(eq(tasks.activityId, "act1"), eq(tasks.authorPid, pid)));
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

describe("一人一题", () => {
  it("同一个人交两次，库里只有一行", async () => {
    await submit("第一道题");
    await submit("第二道题");

    const rows = await mine();
    expect(rows).toHaveLength(1);
  });

  it("留下的是最后一次交的内容", async () => {
    await submit("第一道题");
    await submit("第二道题");

    expect((await mine())[0].content).toBe("第二道题");
  });

  it("updatedAt 是最后一次提交的时间，createdAt 不动", async () => {
    await submit("第一道题");
    const first = (await mine())[0];

    // PGlite 的时间戳精度足够，但两次写挨太近会同毫秒，隔开一点
    await new Promise((r) => setTimeout(r, 20));
    await submit("第二道题");
    const second = (await mine())[0];

    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it("覆盖只动自己那一行，别人的题不受影响", async () => {
    await submit("阿栗的题", "p1");
    await submit("老陈的题", "p2");
    await submit("阿栗改过的题", "p1");

    expect((await mine("p1"))[0].content).toBe("阿栗改过的题");
    expect((await mine("p2"))[0].content).toBe("老陈的题");
  });

  it("唯一索引拦住绕过 upsert 的直接插入", async () => {
    await submit("第一道题");

    await expect(
      client.exec(`INSERT INTO tasks (id, activity_id, author_pid, content, status)
                   VALUES ('t-dup','act1','p1','偷偷插第二道','accepted');`),
    ).rejects.toThrow();
  });
});
