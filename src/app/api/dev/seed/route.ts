import { createHash, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { inviteCode } from "@/core/invite-code";
import { advanceActivity } from "@/db/queries/lifecycle";
import { activities, participants, tasks, users } from "@/db/schema";
import { DEFAULT_POLICY } from "@/core/review-policy";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/session";

/**
 * 造一局带假人假题的活动。**只给本地测试用。**
 *
 * 手动测一遍全流程要开六个浏览器、每个都出一道题、再等到交题截止，
 * 一轮下来十几分钟，改一行代码就得重来一次。这个接口一秒钟给你一局。
 *
 * **默认关闭**，必须显式设 `ENABLE_DEV_TOOLS=1`。
 * 生产环境绝不要设 - 能凭空造参与者就意味着能往任何一局里塞人。
 *
 * 造出来的东西全走正常写入：题是 accepted 的真题，
 * 状态推进调的是真 advanceActivity，分配、踢人、配额全按真规则跑。
 * 不同的只是时间线被压扁了。
 */

// 名字和题都要够 21 个（HARD_MAX_PLAYERS），不然人多了就开始重名重题，
// 报出来的名单没法用来对照测猜测
const MOCK_NAMES = [
  "小北", "阿澈", "老周", "圆圆", "阿肯", "大彭", "小满",
  "阿茶", "老白", "阿晚", "小鹿", "阿吉", "老麦", "点点", "阿柚",
  "小乔", "阿岩", "老宋", "团团", "阿禾", "小舟",
];

const MOCK_TASKS = [
  "让坐你右边的人主动唱一首粤语歌，全程不能提到唱这个字",
  "想办法让一个人主动说出三种不同的动物名，不能直接要求",
  "让一个人主动跟你要微信",
  "把某个人杯子里的酒喝掉，不被本人发现",
  "让一个人在半小时内对你说一句肉麻的情话，不能直接开口要",
  "让一个人主动提议去买夜宵",
  "拿到一个人的手机并用它自拍一张，不被发现",
  "让一个人在十分钟内连续叫你三次名字",
  "让一个人主动跟你换座位",
  "让一个人替你唱完一首歌的副歌",
  "让一个人主动给你倒一杯水，不能开口要",
  "让一个人主动说出自己的星座",
  "让一个人在五分钟内摸一次自己的头发，还要让他自己说出来",
  "让一个人主动提起前任",
  "让一个人把手机递给你看照片，不能直接开口借",
  "让一个人主动学一声动物叫",
  "让一个人主动承认自己五音不全",
  "让一个人给你剥一颗花生或者一块糖",
  "让一个人主动说出今晚谁最能喝",
  "让一个人跟你击掌，但不能先伸手",
  "让一个人主动问你几点了",
];

type Target = "recruiting" | "assigned" | "running" | "voting" | "settled";

const MINUTE = 60_000;

/**
 * 按目标状态排时间线。
 *
 * 不去改状态机，而是把时间摆到「该到的都到了」，再让真 advanceActivity
 * 自己一格一格推。这样推进路径跟线上完全一样，
 * 分配、开投票、结算的副作用一个都不会被跳过。
 */
function timeline(target: Target, now: number) {
  switch (target) {
    case "recruiting":
      return { taskDeadline: now + 30 * MINUTE, startAt: now + 60 * MINUTE, endAt: now + 180 * MINUTE, voteDeadline: now + 240 * MINUTE };
    case "assigned":
      return { taskDeadline: now - MINUTE, startAt: now + 60 * MINUTE, endAt: now + 180 * MINUTE, voteDeadline: now + 240 * MINUTE };
    case "running":
      return { taskDeadline: now - 2 * MINUTE, startAt: now - MINUTE, endAt: now + 120 * MINUTE, voteDeadline: now + 180 * MINUTE };
    case "voting":
      return { taskDeadline: now - 4 * MINUTE, startAt: now - 3 * MINUTE, endAt: now - MINUTE, voteDeadline: now + 60 * MINUTE };
    case "settled":
      return { taskDeadline: now - 5 * MINUTE, startAt: now - 4 * MINUTE, endAt: now - 3 * MINUTE, voteDeadline: now - MINUTE };
  }
}

/**
 * GET 和 POST 走同一套。
 *
 * 留 GET 是为了在手机上能直接开个链接就造一局 -
 * 真机上没法方便地发 POST，而这个接口本来就只在 ENABLE_DEV_TOOLS 下存在。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  return seed(params);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return seed(body);
}

async function seed(body: Record<string, unknown>) {
  try {
    if (process.env.ENABLE_DEV_TOOLS !== "1") {
      return new Response("Not Found", { status: 404 });
    }

    const target: Target = (body.target as Target) ?? "running";
    // 上限跟着机制的硬上限走，见 core/lifecycle 的 HARD_MAX_PLAYERS
    const players: number = Math.min(Math.max(Number(body.players) || 6, 3), 21);
    // 留几个不交题的人，用来看「到点踢出局」这条路
    const slackers: number = Math.min(Math.max(Number(body.slackers) || 0, 0), 3);

    const { userId } = await getOrCreateUser();
    const client = await db;

    // 造局的人自己也要有个能认出来的名字，否则名单里全是「玩家1234」
    const myName = String(body.name ?? "").trim().slice(0, 20);
    if (myName) {
      await client.update(users).set({ nickname: myName }).where(eq(users.id, userId));
    }

    const id = nanoid();
    const code = inviteCode();
    const now = Date.now();
    const t = timeline(target, now);

    await client.transaction(async (tx) => {
      await tx.insert(activities).values({
        id,
        code,
        creatorId: userId,
        title: (body.title as string) ?? "测试局",
        sceneType: "ktv",
        sceneDesc: "朋友包厢唱歌喝酒，都是熟人",
        taskDeadline: new Date(t.taskDeadline),
        startAt: new Date(t.startAt),
        endAt: new Date(t.endAt),
        voteDeadline: new Date(t.voteDeadline),
        shareDesc: "一首歌点唱权",
        bountyTiers: ["0.5", "0.3", "0.2"],
        minPlayers: 3,
        maxPlayers: 21,
        ...DEFAULT_POLICY,
        status: "recruiting",
      });

      // 调这个接口的设备本人也进这一局，否则造完了自己进不去
      const mePid = nanoid();
      await tx.insert(participants).values({ id: mePid, activityId: id, userId });
      await tx.insert(tasks).values({
        id: nanoid(),
        activityId: id,
        authorPid: mePid,
        content: MOCK_TASKS[0],
        status: "accepted",
      });

      for (let i = 1; i < players + slackers; i++) {
        const mockUserId = nanoid();
        await tx.insert(users).values({
          id: mockUserId,
          nickname: MOCK_NAMES[(i - 1) % MOCK_NAMES.length],
          // 假人不需要能登录，给一个不可能撞上的 token 哈希
          deviceTokenHash: createHash("sha256").update(`mock:${mockUserId}`).digest("hex"),
          recoveryCode: String(randomInt(0, 1_000_000)).padStart(6, "0"),
        });
        const pid = nanoid();
        await tx.insert(participants).values({ id: pid, activityId: id, userId: mockUserId });

        // 后面 slackers 个人不交题，到点会被踢出局
        if (i < players) {
          await tx.insert(tasks).values({
            id: nanoid(),
            activityId: id,
            authorPid: pid,
            content: MOCK_TASKS[i % MOCK_TASKS.length],
            status: "accepted",
          });
        }
      }
    });

    // 一格一格推到该到的状态，走的是真状态机
    const steps: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await advanceActivity(client, id, new Date());
      if (!result.advanced) break;
      steps.push(`${result.from} -> ${result.to}`);
    }

    const final = (await client.select({ status: activities.status }).from(activities).where(eq(activities.id, id)))[0];

    return Response.json({
      id,
      code,
      url: `/a/${id}`,
      status: final?.status,
      players,
      slackers,
      steps,
    });
  } catch (error) {
    return apiError(error);
  }
}

