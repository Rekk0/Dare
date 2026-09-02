import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activities } from "@/db/schema";
import { requireParticipant } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; await requireParticipant(id); const row = (await (await db).select({ id: activities.id, code: activities.code, title: activities.title, sceneType: activities.sceneType, startAt: activities.startAt, endAt: activities.endAt, voteDeadline: activities.voteDeadline, shareDesc: activities.shareDesc, status: activities.status }).from(activities).where(eq(activities.id, id)))[0]; if (!row) throw new Error("活动不存在"); return Response.json(row); } catch (error) { return apiError(error); } }
