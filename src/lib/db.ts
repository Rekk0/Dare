import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { applySchema, type Db } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * 进程级数据库单例。
 *
 * **两种模式，选哪个直接决定应用能不能真的玩起来：**
 *
 * 1. `DATABASE_URL` 有值 -> 连真 Postgres。**多进程要用这个。**
 *    web 和 scheduler 是两个 Node 进程，只有连同一个真数据库才能看到彼此的数据。
 *
 * 2. `DATABASE_URL` 为空 -> PGlite 落盘到 `.storage/pgdata`。
 *    **PGlite 是进程内单连接的，两个进程不能同时打开同一个 dataDir。**
 *    所以这个模式下 `pnpm dev` 和 `pnpm scheduler` 不能同时跑  - 
 *    scheduler 会因为拿不到文件锁而失败，或者(用内存库时)看到一个空库、
 *    永远扫到 0 个活动。
 *
 * 换句话说：**要真开一局就得给 DATABASE_URL。** PGlite 模式只适合
 * 单进程的开发和跑测试。这一点在 README 里也写了。
 */

declare global {
  var dareDb: Promise<Db> | undefined;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const sql = postgres(url, { max: 5 });
    return drizzlePostgres(sql, { schema }) as unknown as Db;
  }

  // 落盘而不是纯内存：至少重启不丢数据。
  // 但仍然是单进程的，见上面的说明。
  //
  // 必须先递归建好父目录：PGlite 自己的 mkdir 不是递归的，
  // 目录不存在时报 ENOENT 而不是自动创建。
  const dataDir = "./.storage/pgdata";
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await ensureSchema(client);
  return db;
}

/** 表已经建过就跳过。落盘之后每次启动都会重连同一个库 */
async function ensureSchema(client: PGlite): Promise<void> {
  const existing = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activities'",
  );
  if (existing.rows[0]?.count) return;
  await applySchema(client);
}

export const db: Promise<Db> = (globalThis.dareDb ??= connect());
