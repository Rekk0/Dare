import { createMemoryDb, type Db } from "@/db/client";

declare global {
  var dareDb: Promise<Db> | undefined;
}

/** 开发和单进程部署共用同一个数据库实例。 */
export const db: Promise<Db> = globalThis.dareDb ??= createMemoryDb().then(({ db: client }) => client);
