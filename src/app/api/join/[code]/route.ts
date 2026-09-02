import { nanoid } from "nanoid";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activityByCode, participants } from "@/lib/routes";
import { getOrCreateUser } from "@/lib/session";
export async function POST(_: Request, { params }: { params: Promise<{ code: string }> }) { try { const activity = await activityByCode((await params).code); if (!activity) throw new Error("活动不存在"); const { userId } = await getOrCreateUser(); const client = await db; await client.insert(participants).values({ id: nanoid(), activityId: activity.id, userId }).onConflictDoNothing(); return Response.json({ activityId: activity.id }); } catch (error) { return apiError(error); } }
