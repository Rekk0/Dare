import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { reviewTask } from "@/ai/tasks/taskReview";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activities, participants, tasks } from "@/db/schema";
import { requireParticipant } from "@/lib/session";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; const { pid } = await requireParticipant(id); const body = await request.json(); const client = await db; const activity = (await client.select().from(activities).where(eq(activities.id, id)))[0]; if (!activity) throw new Error("活动不存在"); const count = (await client.select({ id: participants.id }).from(participants).where(eq(participants.activityId, id))).length; const review = await reviewTask({ sceneType: activity.sceneType, sceneDesc: activity.sceneDesc, durationHours: (activity.endAt.getTime() - activity.startAt.getTime()) / 3_600_000, participantCount: count, shareDesc: activity.shareDesc, content: body.content }); const status = review.verdict === "reject" ? "rejected" : "accepted"; await client.insert(tasks).values({ id: nanoid(), activityId: id, authorPid: pid, content: body.content, aiReview: review.scores, status }).onConflictDoUpdate({ target: [tasks.activityId, tasks.authorPid], set: { content: body.content, aiReview: review.scores, status, updatedAt: new Date() } }); return Response.json({ verdict: review.verdict, canForceSubmit: review.canForceSubmit, scores: review.scores }); } catch (error) { return apiError(error); } }
