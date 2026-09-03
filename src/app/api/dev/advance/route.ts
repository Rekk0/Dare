import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { advanceActivity } from "@/db/queries/lifecycle";

/**
 * 手动推进活动一格。**只给本地测试用。**
 *
 * 正常流程靠 scheduler 按时间自动推进，但测试时为了看到任务卡就得等到
 * startAt，一等十几分钟，节奏完全没法接受。这个接口跳过等待。
 *
 * **默认关闭**，必须显式设 `ENABLE_DEV_TOOLS=1` 才启用。
 * 生产环境绝不要设这个变量 —— 能随意推进状态就意味着能提前触发结算。
 *
 * 注意它调的仍然是 advanceActivity，走同一套 CAS 和事务，
 * 不是绕过业务逻辑的后门，只是省掉等时间。
 */
export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_DEV_TOOLS !== "1") {
      return new Response("Not Found", { status: 404 });
    }

    const { activityId, force } = (await request.json()) as {
      activityId: string;
      force?: boolean;
    };
    const client = await db;

    // force 时把时间线往前推，让 nextTransition 认为该推进了
    const now = force ? new Date(Date.now() + 365 * 24 * 3600_000) : new Date();
    const result = await advanceActivity(client, activityId, now);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
