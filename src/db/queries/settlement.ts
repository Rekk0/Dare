import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { settle } from "@/core/settle";
import type { Db } from "../client";
import { activities, aiReports, assignments, guesses, participants, payouts, settlements, tasks, votes } from "../schema";

export interface SettleActivityResult {
  settled: boolean;
  reason?: string;
}

/** 结算必须原子完成，任何写入或守恒校验失败都会回滚状态和全部账目。 */
export async function settleActivity(db: Db, activityId: string): Promise<SettleActivityResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(activities)
      .set({ status: "settled" })
      .where(and(eq(activities.id, activityId), eq(activities.status, "voting")))
      .returning({ bountyTiers: activities.bountyTiers, votePassRatio: activities.votePassRatio });
    const activity = claimed[0];
    if (!activity) return { settled: false, reason: "已结算" };

    const [assignmentRows, guessRows, voteRows, reportRows, participantRows] = await Promise.all([
      tx.select({ id: assignments.id, assigneePid: assignments.assigneePid, authorPid: tasks.authorPid })
        .from(assignments).innerJoin(tasks, eq(assignments.taskId, tasks.id)).where(eq(assignments.activityId, activityId)),
      tx.select({ targetPid: guesses.targetPid, guesserPid: guesses.guesserPid, hit: guesses.hit, voided: guesses.voided, createdAt: guesses.createdAt })
        .from(guesses).where(eq(guesses.activityId, activityId)),
      tx.select({ assignmentId: votes.assignmentId, voterPid: votes.voterPid, verdict: votes.verdict })
        .from(votes).innerJoin(assignments, eq(votes.assignmentId, assignments.id)).where(eq(assignments.activityId, activityId)),
      tx.select({ assignmentId: aiReports.assignmentId, report: aiReports.report })
        .from(aiReports).innerJoin(assignments, eq(aiReports.assignmentId, assignments.id)).where(eq(assignments.activityId, activityId)),
      tx.select({ pid: participants.id }).from(participants).where(eq(participants.activityId, activityId)),
    ]);

    const result = settle({
      assignments: assignmentRows,
      guesses: guessRows.map((guess) => ({ ...guess, createdAt: guess.createdAt.getTime() })),
      votes: voteRows as Array<{ assignmentId: string; voterPid: string; verdict: "pass" | "fail" }>,
      aiReports: reportRows.flatMap((report) => {
        const score = (report.report as { completionScore?: unknown }).completionScore;
        return typeof score === "number" ? [{ assignmentId: report.assignmentId, completionScore: score }] : [];
      }),
      participants: participantRows,
      bountyTiers: activity.bountyTiers.map(Number),
      votePassRatio: Number(activity.votePassRatio),
    });

    await tx.insert(settlements).values(result.settlements.map((item) => ({
      id: nanoid(),
      assignmentId: item.assignmentId,
      outcome: item.outcome,
      toAssignee: String(item.toAssignee),
      toGuessers: String(item.toGuessers),
      forfeited: String(item.forfeited),
      passRatio: item.passRatio === undefined ? undefined : String(item.passRatio),
      voteCount: item.voteCount,
      fallbackByAi: item.fallbackByAi,
    })));
    await tx.insert(payouts).values(result.payouts.map((item) => ({
      id: nanoid(),
      activityId,
      participantId: item.participantId,
      taskShares: String(item.taskShares),
      bountyShares: String(item.bountyShares),
      totalShares: String(item.totalShares),
      busted: item.busted,
      hitTargetPids: item.hitTargetPids,
    })));

    const paid = result.payouts.reduce((sum, item) => sum + item.totalShares, 0);
    const forfeited = result.settlements.reduce((sum, item) => sum + item.forfeited, 0);
    if (paid + forfeited !== assignmentRows.length) {
      throw new Error("结算守恒校验失败");
    }
    return { settled: true };
  });
}
