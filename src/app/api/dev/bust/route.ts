import { and, desc, eq, ne } from "drizzle-orm";
import { submitGuess } from "@/db/queries/guesses";
import { activities, assignments, participants, users } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { activityByCode } from "@/lib/routes";
import { getOrCreateUser } from "@/lib/session";

/**
 * 让某个假人猜中你的任务，把你打成「已暴露」。**只给本地测试用。**
 *
 * BUSTED 是这个游戏情绪最强的一屏，但要自然触发得凑齐一局真人、
 * 还得真有人猜中你，本地根本测不出来。
 *
 * **不走后门。** 这里调的是真 submitGuess：一样消耗那个假人的配额、
 * 一样算命中名次和赏金梯度、一样在同一个事务里把 assignment 打成 busted。
 * 唯一作假的是 similarity 直接给满分，不去打 AI。
 *
 * **默认关闭**，必须显式设 `ENABLE_DEV_TOOLS=1`。
 * 生产环境绝不要设 - 能凭空判定猜中就等于能随意作废别人的奖励。
 */
export async function GET(request: Request) {
  try {
    if (process.env.ENABLE_DEV_TOOLS !== "1") {
      return new Response("Not Found", { status: 404 });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const after = Math.min(Math.max(Number(url.searchParams.get("after")) || 0, 0), 300);

    const { userId } = await getOrCreateUser();
    const client = await db;

    // 不给码就取最新那一局。本地同时只会有一两个测试局，
    // 而调这个接口的时候人往往已经在页面上了，翻码很麻烦
    const activity = code
      ? await activityByCode(code)
      : (await client
          .select({ id: activities.id, title: activities.title })
          .from(activities)
          .orderBy(desc(activities.createdAt))
          .limit(1))[0];
    if (!activity) throw new Error("活动不存在");

    // 谁被猜中：默认是调这个接口的人自己
    const targetName = url.searchParams.get("target");
    const target = targetName
      ? (await client
          .select({ pid: participants.id, nickname: users.nickname })
          .from(participants)
          .innerJoin(users, eq(users.id, participants.userId))
          .where(and(eq(participants.activityId, activity.id), eq(users.nickname, targetName))))[0]
      : (await client
          .select({ pid: participants.id, nickname: users.nickname })
          .from(participants)
          .innerJoin(users, eq(users.id, participants.userId))
          .where(and(eq(participants.activityId, activity.id), eq(participants.userId, userId))))[0];
    if (!target) {
      // 找不到人的时候把名单报出来，省得再去翻库
      const roster = await client
        .select({ nickname: users.nickname })
        .from(participants)
        .innerJoin(users, eq(users.id, participants.userId))
        .where(eq(participants.activityId, activity.id));
      return Response.json(
        { error: "这一局里没有这个人", 名单: roster.map((r) => r.nickname) },
        { status: 404 },
      );
    }

    // 目标得真有一道在执行的任务，否则没有东西可以被识破
    const hasAssignment = (
      await client
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.activityId, activity.id), eq(assignments.assigneePid, target.pid)))
    )[0];
    if (!hasAssignment) throw new Error("目标没有已分配的任务");

    // 找一个还没用完配额的假人来当猜中的人
    const guesser = (
      await client
        .select({ pid: participants.id, nickname: users.nickname })
        .from(participants)
        .innerJoin(users, eq(users.id, participants.userId))
        .where(and(eq(participants.activityId, activity.id), ne(participants.id, target.pid)))
    )[0];
    if (!guesser) throw new Error("这一局没有别人可以来猜");

    const row = (await client.select().from(activities).where(eq(activities.id, activity.id)))[0];

    async function bust() {
      return submitGuess(client, {
        activityId: activity!.id,
        guesserPid: guesser!.pid,
        targetPid: target!.pid,
        text: "（测试用：直接判定猜中）",
        similarity: 100,
        rationale: "dev 工具直接判定，未经过 AI",
        hitThreshold: row!.guessThreshold,
        bountyTiers: row!.bountyTiers.map(Number),
      });
    }

    if (after > 0) {
      // 排到几秒后，好让你先打开任务卡再看着它变
      setTimeout(() => {
        void bust().catch((error) => console.error("[dev/bust] 延时触发失败:", error));
      }, after * 1000);
      return Response.json({
        scheduled: true,
        after,
        target: target.nickname,
        guesser: guesser.nickname,
        hint: `${after} 秒后 ${guesser.nickname} 会猜中 ${target.nickname}，刷新任务卡就能看到`,
      });
    }

    const result = await bust();
    return Response.json({
      busted: true,
      target: target.nickname,
      guesser: guesser.nickname,
      outcome: result.outcome,
      hint: `${guesser.nickname} 已经猜中 ${target.nickname}，现在打开任务卡`,
    });
  } catch (error) {
    return apiError(error);
  }
}
