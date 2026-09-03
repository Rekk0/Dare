import { nanoid } from "nanoid";
import { inviteCode } from "@/core/invite-code";
import { validatePlayerRange, validateSchedule, type ScheduleProblem } from "@/core/lifecycle";
import { validatePolicy } from "@/core/review-policy";
import { activities, participants } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/session";

/** 把会抛的校验收成一条 problem，让四种失败能同时报出来而不是撞上第一个就停 */
function collect<T>(field: string, run: () => T, problems: ScheduleProblem[]): T | null {
  try {
    return run();
  } catch (error) {
    problems.push({ field, message: error instanceof Error ? error.message : "填得不对" });
    return null;
  }
}

/**
 * 建活动。
 *
 * **校验失败要说清楚是哪个字段。** 第一版把时间、人数、奖励、赏金梯度
 * 四类失败合并成一句「参数无效」，前端再翻成「没建成，再试一次」，
 * 结果用户和我都没法知道到底哪儿填错了，只能一个个字段试。
 * 现在一次把所有问题都返回，前端逐条显示。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const problems: ScheduleProblem[] = [];

    const policy = collect("policy", () => validatePolicy({
      minFeasibility: body.minFeasibility,
      minStealth: body.minStealth,
      minFun: body.minFun,
      minVerifiability: body.minVerifiability,
      edginess: body.edginess,
    }), problems);

    const range = collect("players", () => validatePlayerRange(body.minPlayers, body.maxPlayers), problems);

    problems.push(...validateSchedule({
      taskDeadline: new Date(body.taskDeadline),
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      voteDeadline: new Date(body.voteDeadline),
    }, new Date()));

    const title = String(body.title ?? "").trim();
    if (!title) problems.push({ field: "title", message: "给这一局起个名字" });

    const shareDesc = String(body.shareDesc ?? "").trim();
    if (!shareDesc) problems.push({ field: "shareDesc", message: "写清楚一份奖励是什么" });

    const tiers: unknown = body.bountyTiers;
    if (!Array.isArray(tiers) || !tiers.length || tiers.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0)) {
      problems.push({ field: "bountyTiers", message: "赏金梯度不对" });
    } else if ((tiers as number[]).reduce((a, b) => a + b, 0) > 1) {
      // 超过 1 份就破坏守恒：一道题的池子只有一份，分不出更多
      problems.push({ field: "bountyTiers", message: "赏金梯度加起来不能超过一份" });
    }

    if (problems.length || !policy || !range) {
      return Response.json({ problems }, { status: 400 });
    }

    const { userId } = await getOrCreateUser();
    const id = nanoid();
    const code = inviteCode();
    const client = await db;
    await client.transaction(async (tx) => {
      await tx.insert(activities).values({
        id,
        code,
        creatorId: userId,
        title,
        sceneType: body.sceneType,
        sceneDesc: body.sceneDesc ?? "",
        taskDeadline: new Date(body.taskDeadline),
        startAt: new Date(body.startAt),
        endAt: new Date(body.endAt),
        voteDeadline: new Date(body.voteDeadline),
        shareDesc,
        // numeric[] 在 drizzle 里是 string[]，读回来时各处都 map(Number)
        bountyTiers: (tiers as number[]).map(String),
        ...policy,
        ...range,
        status: "recruiting",
      });
      await tx.insert(participants).values({ id: nanoid(), activityId: id, userId });
    });
    return Response.json({ id, code }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
