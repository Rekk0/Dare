import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activityByCode, participants } from "@/lib/routes";
import { users } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";

/**
 * 这个码对应哪一局，以及我是不是已经在里面了。
 *
 * 加这个 GET 是因为：已经在局里的人再填一次邀请码，原来还会让他重填一遍昵称，
 * 填完 onConflictDoNothing 悄悄什么都没做 - 用户以为自己重新加入了，
 * 其实昵称根本没改。现在进页面先问一句，已经在里面就直接给跳转。
 */
export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const activity = await activityByCode((await params).code);
    if (!activity) throw new Error("活动不存在");
    const { userId } = await getOrCreateUser();
    const client = await db;
    const mine = (
      await client
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.activityId, activity.id), eq(participants.userId, userId)))
    )[0];
    return Response.json({ activityId: activity.id, title: activity.title, joined: Boolean(mine) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const activity = await activityByCode((await params).code);
    if (!activity) throw new Error("活动不存在");
    const { userId } = await getOrCreateUser();
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname ?? "").trim().slice(0, 20);
    const client = await db;

    // 昵称必须落库。之前只存在 sessionStorage 里，谁也读不到 -
    // 用户填了名字，别人在名单和投票页看到的还是「玩家1234」
    if (nickname) {
      await client.update(users).set({ nickname }).where(eq(users.id, userId));
    }

    await client
      .insert(participants)
      .values({ id: nanoid(), activityId: activity.id, userId })
      .onConflictDoNothing();
    return Response.json({ activityId: activity.id });
  } catch (error) {
    return apiError(error);
  }
}
