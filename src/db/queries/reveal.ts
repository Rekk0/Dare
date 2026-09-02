import { and, eq } from "drizzle-orm";
import { projectReveal, type RevealAssignmentDto } from "@/core/visibility";
import type { Db } from "../client";
import { activities, assignments, guesses, tasks } from "../schema";

export interface RevealData {
  assignments: RevealAssignmentDto[];
}

/** 每条揭晓记录都通过 projectReveal 裁剪，不能在这里复制保密规则。 */
export async function getReveal(db: Db, activityId: string, viewerPid: string): Promise<RevealData> {
  const rows = await db
    .select({
      status: activities.status,
      assignmentId: assignments.id,
      assigneePid: assignments.assigneePid,
      authorPid: tasks.authorPid,
      taskContent: tasks.content,
      assignmentStatus: assignments.status,
      bustedByPid: guesses.guesserPid,
    })
    .from(assignments)
    .innerJoin(activities, eq(assignments.activityId, activities.id))
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .leftJoin(guesses, and(eq(guesses.targetPid, assignments.assigneePid), eq(guesses.rank, 1)))
    .where(eq(assignments.activityId, activityId));

  return {
    assignments: rows.map((row) => projectReveal(
      { pid: viewerPid, status: row.status as "draft" | "recruiting" | "locked" | "running" | "voting" | "settled" },
      {
        assignmentId: row.assignmentId,
        assigneePid: row.assigneePid,
        authorPid: row.authorPid,
        taskContent: row.taskContent,
        busted: row.assignmentStatus === "busted",
        bustedByPid: row.bustedByPid,
      },
    )),
  };
}
