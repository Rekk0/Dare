import { nanoid } from "nanoid";
import { validateSchedule } from "@/core/lifecycle";
import { activities, participants } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/session";
export async function POST(request: Request) { try { const body = await request.json(); const startAt = new Date(body.startAt); const endAt = new Date(body.endAt); const voteDeadline = new Date(body.voteDeadline); if (validateSchedule({ startAt, endAt, voteDeadline }, new Date()).length || !Array.isArray(body.bountyTiers) || body.bountyTiers.reduce((a: number, b: number) => a + b, 0) > 1) throw new Error("参数无效"); const { userId } = await getOrCreateUser(); const id = nanoid(); const code = nanoid(6).toUpperCase(); const client = await db; await client.transaction(async (tx) => { await tx.insert(activities).values({ id, code, creatorId: userId, title: body.title, sceneType: body.sceneType, sceneDesc: body.sceneDesc ?? "", startAt, endAt, voteDeadline, shareDesc: body.shareDesc, bountyTiers: body.bountyTiers }); await tx.insert(participants).values({ id: nanoid(), activityId: id, userId }); }); return Response.json({ id, code }, { status: 201 }); } catch (error) { return apiError(error); } }
