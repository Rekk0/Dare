import { eq } from "drizzle-orm";
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
      .select({ pid: participants.id, nickname: users.nickname, eliminatedAt: participants.eliminatedAt })
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
