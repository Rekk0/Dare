import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { projectMyAssignment, projectReveal, type ActivityStatus } from "@/core/visibility";
import { assignments, activities, evidences, guesses, participants, payouts, tasks } from "@/db/schema";
import { db } from "@/lib/db";

export async function activityByCode(code: string) { return (await (await db).select().from(activities).where(eq(activities.code, code)))[0]; }
export async function assignmentFacts(assignmentId: string) {
  return (await (await db).select({ id: assignments.id, activityId: assignments.activityId, status: activities.status, assigneePid: assignments.assigneePid, authorPid: tasks.authorPid, content: tasks.content, assignmentStatus: assignments.status })
    .from(assignments).innerJoin(activities, eq(assignments.activityId, activities.id)).innerJoin(tasks, eq(assignments.taskId, tasks.id)).where(eq(assignments.id, assignmentId)))[0];
}
/**
 * 我的任务卡。
 *
 * bustedByPid 必须真的从 guesses 取（rank 1 那条），不能写死成 null。
 * 写死虽然更安全，但 settled 之后就永远揭晓不了识破关系，
 * 结算页的关系图画不出来。该不该给由 projectMyAssignment 判，不在这里判。
 */
export async function myAssignment(activityId: string, pid: string) {
  const row = (
    await (await db)
      .select({
        assignmentId: assignments.id,
        assigneePid: assignments.assigneePid,
        authorPid: tasks.authorPid,
        taskContent: tasks.content,
        assignmentStatus: assignments.status,
        status: activities.status,
        bustedByPid: guesses.guesserPid,
      })
      .from(assignments)
      .innerJoin(activities, eq(assignments.activityId, activities.id))
      .innerJoin(tasks, eq(assignments.taskId, tasks.id))
      .leftJoin(
        guesses,
        and(eq(guesses.targetPid, assignments.assigneePid), eq(guesses.rank, 1)),
      )
      .where(
        and(eq(assignments.activityId, activityId), eq(assignments.assigneePid, pid)),
      )
  )[0];
  if (!row) throw new Error("目标没有已分配的任务");
  return projectMyAssignment(
    { pid, status: row.status as ActivityStatus },
    { ...row, busted: row.assignmentStatus === "busted" },
  );
}

/**
 * 揭晓。直接复用 db/queries/reveal.ts，不在这里重写一套查询。
 *
 * 重写的代价是真实发生过的：第一版在这里另查了一遍并把 bustedByPid 写死成
 * null，导致 M6 已经审过的那份成了死代码，识破关系永远揭晓不了。
 */
export async function reveal(activityId: string, pid: string) {
  const { getReveal } = await import("@/db/queries/reveal");
  const data = await getReveal(await db, activityId, pid);
  return data.assignments;
}
export { activities, assignments, evidences, guesses, participants, payouts, tasks, nanoid };
