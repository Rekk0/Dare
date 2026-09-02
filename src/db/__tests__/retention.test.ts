import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../client";
import { activities } from "../schema";
import { purgeExpiredActivities } from "../queries/retention";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;

const now = new Date("2026-09-03T00:00:00.000Z");

async function seed(id: string, status: "settled" | "voting", voteDeadline: Date, storageKey: string) {
  const suffix = id.replace(/[^a-z]/g, "");
  await client.exec(`
    INSERT INTO users (id, nickname, device_token_hash, recovery_code) VALUES ('u${suffix}', '用户', 'hash', 'recovery');
    INSERT INTO activities (id, code, creator_id, title, scene_type, start_at, end_at, vote_deadline, share_desc, status)
      VALUES ('${id}', '${suffix.padEnd(6, "X").slice(0, 6)}', 'u${suffix}', '活动', 'other',
        to_timestamp(${(voteDeadline.getTime() - 7200_000) / 1000}), to_timestamp(${(voteDeadline.getTime() - 3600_000) / 1000}),
        to_timestamp(${voteDeadline.getTime() / 1000}), '奖励', '${status}');
    INSERT INTO participants (id, activity_id, user_id) VALUES ('p${suffix}', '${id}', 'u${suffix}');
    INSERT INTO tasks (id, activity_id, author_pid, content, status) VALUES ('t${suffix}', '${id}', 'p${suffix}', '任务', 'accepted');
    INSERT INTO assignments (id, activity_id, task_id, assignee_pid) VALUES ('a${suffix}', '${id}', 't${suffix}', 'p${suffix}');
    INSERT INTO evidences (id, assignment_id, kind, storage_key, mime, bytes) VALUES ('e${suffix}', 'a${suffix}', 'image', '${storageKey}', 'image/jpeg', 1);
  `);
}

async function activityIds(): Promise<string[]> {
  return (await db.select({ id: activities.id }).from(activities)).map((activity) => activity.id).sort();
}

beforeEach(async () => {
  const memory = await createMemoryDb();
  db = memory.db;
  client = memory.client;
  close = memory.close;
});

afterEach(async () => close());

describe("活动数据保留期", () => {
  it("已结算且过期的活动被清掉，未过期的不动", async () => {
    await seed("old", "settled", new Date(now.getTime() - 8 * 86400_000), "old.jpg");
    await seed("new", "settled", new Date(now.getTime() - 6 * 86400_000), "new.jpg");
    const deleted: string[] = [];

    const result = await purgeExpiredActivities(db, { delete: async (key) => { deleted.push(key); }, signUpload: async () => { throw new Error("不应调用"); }, signDownload: async () => { throw new Error("不应调用"); } }, now, 7);

    expect(result).toEqual({ purged: 1, filesDeleted: 1, failed: 0 });
    expect(deleted).toEqual(["old.jpg"]);
    expect(await activityIds()).toEqual(["new"]);
  });

  it("未结算的老活动不动", async () => {
    await seed("voting", "voting", new Date(now.getTime() - 30 * 86400_000), "voting.jpg");

    const result = await purgeExpiredActivities(db, { delete: async () => undefined, signUpload: async () => { throw new Error("不应调用"); }, signDownload: async () => { throw new Error("不应调用"); } }, now, 7);

    expect(result).toEqual({ purged: 0, filesDeleted: 0, failed: 0 });
    expect(await activityIds()).toEqual(["voting"]);
  });

  it("证据文件先于数据库行删除", async () => {
    await seed("old", "settled", new Date(now.getTime() - 8 * 86400_000), "old.jpg");
    const calls: string[] = [];
    const storage = {
      delete: async () => {
        calls.push("delete-file");
        expect(await activityIds()).toEqual(["old"]);
      },
      signUpload: async () => { throw new Error("不应调用"); },
      signDownload: async () => { throw new Error("不应调用"); },
    };

    await purgeExpiredActivities(db, storage, now, 7);

    expect(calls).toEqual(["delete-file"]);
    expect(await activityIds()).toEqual([]);
  });

  it("单个活动删除失败时其余照常清理", async () => {
    await seed("bad", "settled", new Date(now.getTime() - 8 * 86400_000), "bad.jpg");
    await seed("good", "settled", new Date(now.getTime() - 8 * 86400_000), "good.jpg");

    const result = await purgeExpiredActivities(db, { delete: async (key) => { if (key === "bad.jpg") throw new Error("删除失败"); }, signUpload: async () => { throw new Error("不应调用"); }, signDownload: async () => { throw new Error("不应调用"); } }, now, 7);

    expect(result).toEqual({ purged: 1, filesDeleted: 1, failed: 1 });
    expect(await activityIds()).toEqual(["bad"]);
  });
});
