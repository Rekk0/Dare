import { and, eq } from "drizzle-orm";
import { judgeGuess } from "@/ai/tasks/guessJudge";
import { submitGuess } from "@/db/queries/guesses";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activities, assignments, tasks } from "@/db/schema";
import { requireParticipant } from "@/lib/session";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; const { pid } = await requireParticipant(id); const body = await request.json(); const client = await db; const activity = (await client.select().from(activities).where(eq(activities.id, id)))[0]; if (!activity) throw new Error("活动不存在"); const target = (await client.select({ content: tasks.content }).from(assignments).innerJoin(tasks, eq(assignments.taskId, tasks.id)).where(and(eq(assignments.activityId, id), eq(assignments.assigneePid, body.targetPid))))[0]; if (!target) throw new Error("目标没有已分配的任务"); const judged = await judgeGuess(target.content, body.text); const result = await submitGuess(client, { activityId: id, guesserPid: pid, targetPid: body.targetPid, text: body.text, similarity: judged.similarity, rationale: judged.rationale, hitThreshold: activity.guessThreshold, bountyTiers: activity.bountyTiers.map(Number) }); return Response.json(result); } catch (error) { return apiError(error); } }
