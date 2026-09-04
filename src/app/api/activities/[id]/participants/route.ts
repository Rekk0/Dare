import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { participants, users } from "@/db/schema";
import { requireParticipant } from "@/lib/session";

/**
 * 同一局的参与者名册。
 *
 * 昵称对同局的人不算秘密：大家本来就面对面坐在一起，谁在场是公开信息。
 * 但仍然要过 requireParticipant，只有这一局的参与者能看到名册。
 *
 * 这个接口是猜测页的前提：**没有名册就只能显示「玩家 1」「玩家 2」，
 * 而你没法去猜一个不知道是谁的人。**
 *
 * 只返回 pid 和昵称，不返回 userId、设备 token、恢复码这些身份凭据。
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { pid } = await requireParticipant(id);

    const rows = await (await db)
      // 这一局设过名字就用这一局的，没设过回落到设备上的默认名
      .select({
        pid: participants.id,
        nickname: sql<string>`coalesce(${participants.nickname}, ${users.nickname})`,
        eliminatedAt: participants.eliminatedAt,
      })
      .from(participants)
      .innerJoin(users, eq(participants.userId, users.id))
      .where(eq(participants.activityId, id));

    return Response.json({
      me: pid,
      participants: rows,
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * 改自己在这一局里的名字。
 *
 * 只能改自己那一行：pid 来自 requireParticipant，不从请求体里取，
 * 否则谁都能改别人的名字。
 *
 * 创建者建完局走这里，参与者填邀请码时在加入接口里一并设置。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { userId, pid } = await requireParticipant(id);

    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname ?? "").trim().slice(0, 20);
    if (!nickname) throw new Error("留个名字，大家好认你");

    const client = await db;
    await client.update(participants).set({ nickname }).where(eq(participants.id, pid));
    // users 上那份是设备级默认名，下次进别的局时用它兜底
    await client.update(users).set({ nickname }).where(eq(users.id, userId));

    return Response.json({ nickname });
  } catch (error) {
    return apiError(error);
  }
}
