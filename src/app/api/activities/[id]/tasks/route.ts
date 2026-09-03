import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { reviewTask } from "@/ai/tasks/taskReview";
import type { Edginess } from "@/core/review-policy";
import { readReviewToken, signReviewToken } from "@/core/review-token";
import { activities, participants, tasks } from "@/db/schema";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireParticipant } from "@/lib/session";

/**
 * 签名密钥，跟证据直传共用一个。
 * 不设环境变量时进程启动随机生成，重启后未用掉的预审凭据失效 - TTL 才 15 分钟，
 * 开发环境可以接受，生产必须给 STORAGE_SIGNING_SECRET。
 */
const signingSecret = process.env.STORAGE_SIGNING_SECRET
  ? Buffer.from(process.env.STORAGE_SIGNING_SECRET, "utf8")
  : randomBytes(32);

/**
 * 出题分两步，**只有第二步写库**。
 *
 * 第一步预审：打一次 AI，返回评分和一张预审凭据。**不落任何数据。**
 * 用户还在看 AI 怎么说，压根没决定要不要交，这一步不该产生持久化。
 *
 * 第二步确认：带上正文和凭据，验签通过才入库。凭据按住了活动、出题人和正文，
 * 所以换正文验不过 - 「拿正常题过预审、确认时换成被拦的内容」这条路是堵死的。
 * 判成 reject 的题不发凭据，交不上去。
 *
 * 确认不重跑预审是刻意的：重跑既多花 2 到 5 秒，又可能因为模型的随机性
 * 给出跟用户刚看到的不一样的分数。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { pid } = await requireParticipant(id);
    const body = await request.json();
    const content = String(body.content ?? "");
    const client = await db;

    if (body.confirm) {
      const claims = { activityId: id, pid, content };
      const verified = readReviewToken(signingSecret, String(body.token ?? ""), claims, Date.now());
      if (!verified) throw new Error("预审凭据无效，请重新预审");

      // 评分取自凭据，不取自请求体 - 客户端说了算的数字不该进库
      const aiReview = verified.scores as Record<string, unknown> | null;
      await client
        .insert(tasks)
        .values({ id: nanoid(), activityId: id, authorPid: pid, content, aiReview, status: "accepted" })
        .onConflictDoUpdate({
          target: [tasks.activityId, tasks.authorPid],
          set: { content, aiReview, status: "accepted", updatedAt: new Date() },
        });
      return Response.json({ confirmed: true });
    }

    const activity = (await client.select().from(activities).where(eq(activities.id, id)))[0];
    if (!activity) throw new Error("活动不存在");
    const count = (await client.select({ id: participants.id }).from(participants).where(eq(participants.activityId, id))).length;
    const review = await reviewTask(
      { sceneType: activity.sceneType, sceneDesc: activity.sceneDesc, durationHours: (activity.endAt.getTime() - activity.startAt.getTime()) / 3_600_000, participantCount: count, shareDesc: activity.shareDesc, content },
      { minFeasibility: activity.minFeasibility, minStealth: activity.minStealth, minFun: activity.minFun, minVerifiability: activity.minVerifiability, edginess: activity.edginess as Edginess },
    );

    // 被拦的题不发凭据，等于交不上去
    const token = review.verdict === "reject" ? undefined : signReviewToken(signingSecret, { activityId: id, pid, content }, review.scores, Date.now());
    return Response.json({ verdict: review.verdict, canForceSubmit: review.canForceSubmit, scores: review.scores, token });
  } catch (error) {
    return apiError(error);
  }
}
