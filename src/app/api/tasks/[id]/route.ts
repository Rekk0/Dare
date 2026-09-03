import { eq } from "drizzle-orm";
import { reviewTask } from "@/ai/tasks/taskReview";
import type { Edginess } from "@/core/review-policy";
import { activities, tasks } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireParticipant } from "@/lib/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const taskId = (await params).id;
    const client = await db;
    const task = (await client.select().from(tasks).where(eq(tasks.id, taskId)))[0];
    if (!task) throw new Error("活动不存在");
    const { pid } = await requireParticipant(task.activityId);
    if (pid !== task.authorPid) throw new Error("非参与者");
    const body = await request.json();
    const activity = (await client.select().from(activities).where(eq(activities.id, task.activityId)))[0];
    if (!activity) throw new Error("活动不存在");
    const review = await reviewTask({ sceneType: activity.sceneType, sceneDesc: activity.sceneDesc, durationHours: 1, participantCount: 0, shareDesc: activity.shareDesc, content: body.content }, { minFeasibility: activity.minFeasibility, minStealth: activity.minStealth, minFun: activity.minFun, minVerifiability: activity.minVerifiability, edginess: activity.edginess as Edginess });
    await client.update(tasks).set({ content: body.content, aiReview: review.scores, status: review.verdict === "reject" ? "rejected" : "accepted", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    return Response.json({ verdict: review.verdict, canForceSubmit: review.canForceSubmit, scores: review.scores });
  } catch (error) { return apiError(error); }
}
