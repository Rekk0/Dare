import { and, eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activities, participants } from "@/db/schema";
import { getOrCreateUser, requireParticipant } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; const { userId } = await getOrCreateUser(); const client = await db; const row = (await client.select({ id: activities.id, code: activities.code, title: activities.title, sceneType: activities.sceneType, taskDeadline: activities.taskDeadline, startAt: activities.startAt, endAt: activities.endAt, voteDeadline: activities.voteDeadline, shareDesc: activities.shareDesc, status: activities.status, eliminatedAt: participants.eliminatedAt }).from(activities).innerJoin(participants, and(eq(participants.activityId, activities.id), eq(participants.userId, userId))).where(eq(activities.id, id)))[0]; if (!row) throw new Error("非参与者"); return Response.json({ ...row, eliminated: row.eliminatedAt !== null }); } catch (error) { return apiError(error); } }
