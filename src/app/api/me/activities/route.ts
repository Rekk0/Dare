import { desc, eq } from "drizzle-orm";
import { activities, participants } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/session";

/**
 * 我参加的局。
 *
 * 只要加入了就算，还没开场的也算 - 用户可能同时在好几局里，
 * 加入完关掉页面就找不回去是很容易发生的事。
 *
 * **不返回任何跟题有关的东西**：这一页只是个入口列表，
 * 谁出了什么题、谁领了什么题都不该从这里漏出去。
 * 出局的人也列出来，但标出来，否则他会以为自己进错了地方。
 */
export async function GET() {
  try {
    const { userId } = await getOrCreateUser();
    const client = await db;

    const rows = await client
      .select({
        id: activities.id,
        title: activities.title,
        code: activities.code,
        status: activities.status,
        taskDeadline: activities.taskDeadline,
        startAt: activities.startAt,
        endAt: activities.endAt,
        voteDeadline: activities.voteDeadline,
        eliminatedAt: participants.eliminatedAt,
      })
      .from(participants)
      .innerJoin(activities, eq(activities.id, participants.activityId))
      .where(eq(participants.userId, userId))
      .orderBy(desc(activities.createdAt));

    return Response.json({
      activities: rows.map((r) => ({
        id: r.id,
        title: r.title,
        code: r.code,
        status: r.status,
        taskDeadline: r.taskDeadline,
        startAt: r.startAt,
        endAt: r.endAt,
        voteDeadline: r.voteDeadline,
        eliminated: r.eliminatedAt !== null,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
