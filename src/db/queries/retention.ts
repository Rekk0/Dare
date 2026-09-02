import { and, eq, lt } from "drizzle-orm";

import type { StoragePort } from "@/storage/types";
import type { Db } from "../client";
import { activities, assignments, evidences } from "../schema";

export interface RetentionResult {
  purged: number;
  filesDeleted: number;
  failed: number;
}

/** 删除超过保留期的已结算活动，始终先删证据文件再删活动数据库行。 */
export async function purgeExpiredActivities(
  db: Db,
  storage: StoragePort,
  now: Date,
  retentionDays: number,
): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.status, "settled"), lt(activities.voteDeadline, cutoff)));
  let purged = 0;
  let filesDeleted = 0;
  let failed = 0;

  for (const activity of expired) {
    try {
      const files = await db
        .select({ storageKey: evidences.storageKey })
        .from(evidences)
        .innerJoin(assignments, eq(evidences.assignmentId, assignments.id))
        .where(eq(assignments.activityId, activity.id));
      for (const file of files) {
        await storage.delete(file.storageKey);
        filesDeleted += 1;
      }
      await db.delete(activities).where(eq(activities.id, activity.id));
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { purged, filesDeleted, failed };
}
