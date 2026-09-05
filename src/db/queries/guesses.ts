import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isVoidedHit } from "@/core/bounty";
import { toGuessOutcome, type GuessResultDto } from "@/core/visibility";
import type { Db } from "../client";
import { activities, assignments, guesses, tasks } from "../schema";

export interface SubmitGuessParams {
  activityId: string;
  guesserPid: string;
  targetPid: string;
  text: string;
  similarity: number;
  rationale: string;
  hitThreshold: number;
  bountyTiers: readonly number[];
}

/** 在单一事务中消耗配额、确定命中名次并更新被识破状态。 */
export async function submitGuess(db: Db, params: SubmitGuessParams): Promise<GuessResultDto> {
  if (params.guesserPid === params.targetPid) {
    throw new Error("不能猜自己");
  }

  return db.transaction(async (tx) => {
    const activityRows = await tx
      .select({ guessQuota: activities.guessQuota })
      .from(activities)
      .where(eq(activities.id, params.activityId));
    const activity = activityRows[0];
    if (!activity) throw new Error("活动不存在");

    const usedRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(guesses)
      .where(and(eq(guesses.activityId, params.activityId), eq(guesses.guesserPid, params.guesserPid)));
    const used = usedRows[0]?.count ?? 0;
    if (used >= activity.guessQuota) throw new Error("猜测配额已用尽");

    const targetRows = await tx
      .select({ authorPid: tasks.authorPid })
      .from(assignments)
      .innerJoin(tasks, eq(assignments.taskId, tasks.id))
      .where(and(eq(assignments.activityId, params.activityId), eq(assignments.assigneePid, params.targetPid)));
    const target = targetRows[0];
    if (!target) throw new Error("目标没有已分配的任务");

    const outcome = toGuessOutcome(params.similarity, params.hitThreshold);
    const hit = outcome === "hit";
    const voided = hit && isVoidedHit({
      guesserPid: params.guesserPid,
      targetPid: params.targetPid,
      hit,
      createdAt: 0,
    }, target.authorPid);

    let rank: number | null = null;
    if (hit && !voided) {
      // guesses 为空时 SELECT ... FOR UPDATE 没有可锁的行，先锁目标 assignment
      // 才能让两个首个命中者也串行进入下面的名次计算。
      await tx.execute(sql`
        SELECT id
        FROM assignments
        WHERE activity_id = ${params.activityId}
          AND assignee_pid = ${params.targetPid}
        FOR UPDATE
      `);
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM guesses
        WHERE activity_id = ${params.activityId}
          AND target_pid = ${params.targetPid}
          AND hit AND NOT voided
        FOR UPDATE
      `);
      rank = locked.rows.length + 1;
    }

    await tx.insert(guesses).values({
      id: nanoid(),
      activityId: params.activityId,
      guesserPid: params.guesserPid,
      targetPid: params.targetPid,
      text: params.text,
      similarity: params.similarity,
      rationale: params.rationale,
      hit,
      voided,
      rank,
    });

    if (rank === 1) {
      await tx
        .update(assignments)
        .set({ status: "busted" })
        .where(and(
          eq(assignments.activityId, params.activityId),
          eq(assignments.assigneePid, params.targetPid),
          sql`${assignments.status} <> 'busted'`,
        ));
    }

    const quotaLeft = activity.guessQuota - used - 1;
    const quotaTotal = activity.guessQuota;
    if (!hit || voided || rank === null) return { outcome, quotaLeft, quotaTotal };
    return { outcome, quotaLeft, quotaTotal, rank, bountyShares: params.bountyTiers[rank - 1] ?? 0 };
  });
}
