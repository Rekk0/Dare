import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { createMemoryDb, type Db } from "../client";
import { participants, users } from "../schema";

/**
 * 每局一个昵称。
 *
 * 昵称本来只存在 users 上，是设备级的：同一个人加入第二局时改名字，
 * 第一局名单里他的名字也跟着变。现在 participants 上有一份只管这一局的，
 * 为空时回落到 users 那份。
 *
 * 这里验的是名册接口依赖的那条 coalesce 语义，以及跨局互不影响。
 */

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

// 一个人，两局：act1 里设了这一局的名字，act2 里没设
async function seed(client: PGlite) {
  const now = Date.now();
  const times = (offset: number) => `to_timestamp(${(now + offset) / 1000})`;
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES
      ('u1','玩家1234','h1','r1'), ('u2','老陈','h2','r2');
    INSERT INTO activities (id, code, creator_id, title, scene_type, task_deadline, start_at, end_at, vote_deadline, share_desc)
      VALUES
        ('act1','ABC123','u1','周五 KTV','ktv',
         ${times(3600_000)}, ${times(3600_000)}, ${times(7200_000)}, ${times(10800_000)}, '一首歌点唱权'),
        ('act2','XYZ789','u1','周六桌游','home',
         ${times(3600_000)}, ${times(3600_000)}, ${times(7200_000)}, ${times(10800_000)}, '一次免单');
    INSERT INTO participants (id, activity_id, user_id, nickname) VALUES
      ('p1','act1','u1','局里的阿栗'),
      ('p2','act1','u2',NULL),
      ('p3','act2','u1',NULL);
  `);
}

// 名册接口读昵称就是这么读的
async function roster(activityId: string) {
  return db
    .select({
      pid: participants.id,
      nickname: sql<string>`coalesce(${participants.nickname}, ${users.nickname})`,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(eq(participants.activityId, activityId));
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

describe("每局一个昵称", () => {
  it("设过这一局的名字就用这一局的", async () => {
    const rows = await roster("act1");
    expect(rows.find((r) => r.pid === "p1")?.nickname).toBe("局里的阿栗");
  });

  it("没设过就回落到设备上的默认名", async () => {
    const rows = await roster("act1");
    expect(rows.find((r) => r.pid === "p2")?.nickname).toBe("老陈");
  });

  it("同一个人在另一局里没设名字，不会串到这一局的名字", async () => {
    const rows = await roster("act2");
    expect(rows.find((r) => r.pid === "p3")?.nickname).toBe("玩家1234");
  });

  it("改这一局的名字不影响同一个人在别的局里的名字", async () => {
    await db.update(participants).set({ nickname: "换个名" }).where(eq(participants.id, "p1"));

    expect((await roster("act1")).find((r) => r.pid === "p1")?.nickname).toBe("换个名");
    expect((await roster("act2")).find((r) => r.pid === "p3")?.nickname).toBe("玩家1234");
  });

  it("改设备默认名，只影响没设过局内名字的那些局", async () => {
    await db.update(users).set({ nickname: "新默认名" }).where(eq(users.id, "u1"));

    // act1 设过，不受影响
    expect((await roster("act1")).find((r) => r.pid === "p1")?.nickname).toBe("局里的阿栗");
    // act2 没设过，跟着变
    expect((await roster("act2")).find((r) => r.pid === "p3")?.nickname).toBe("新默认名");
  });
});
