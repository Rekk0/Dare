import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { canVote, type AssignmentFacts } from "@/core/visibility";
import type { Db } from "../client";
import { activities, assignments, participants, tasks, votes } from "../schema";

export class VoteConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "VoteConflictError";
  }
}

export interface CastVoteParams {
  assignmentId: string;
  voterPid: string;
  verdict: "pass" | "fail";
  score?: number;
  comment?: string;
}

/** 投票资格只由 core/visibility.ts 判定，写库层不复制规则。 */
export async function castVote(db: Db, params: CastVoteParams): Promise<void> {
  const rows = await db
    .select({
      activityId: assignments.activityId,
      status: activities.status,
      assigneePid: assignments.assigneePid,
      authorPid: tasks.authorPid,
      assignmentId: assignments.id,
      assignmentStatus: assignments.status,
    })
    .from(assignments)
    .innerJoin(activities, eq(assignments.activityId, activities.id))
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(assignments.id, params.assignmentId));
  const row = rows[0];
  if (!row) throw new Error("任务不存在");

  const voter = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.id, params.voterPid), eq(participants.activityId, row.activityId)));
  if (!voter[0]) throw new Error("不在活动中");

  const facts: AssignmentFacts = {
    assignmentId: row.assignmentId,
    assigneePid: row.assigneePid,
    authorPid: row.authorPid,
    busted: row.assignmentStatus === "busted",
  };
  if (!canVote({ pid: params.voterPid, status: row.status as "voting" }, facts)) {
    if (facts.busted) throw new VoteConflictError("任务已被识破");
    throw new Error("当前不能投票");
  }

  await db
    .insert(votes)
    .values({ id: nanoid(), ...params })
    .onConflictDoUpdate({
      target: [votes.assignmentId, votes.voterPid],
      set: { verdict: params.verdict, score: params.score ?? null, comment: params.comment ?? null },
    });
}
