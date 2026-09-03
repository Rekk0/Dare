import { suggestPolicy } from "@/ai/tasks/suggestPolicy";
import { apiError } from "@/lib/api";
import { getOrCreateUser } from "@/lib/session";

/**
 * 建活动前让 AI 看一眼场景，给一组建议的预审标准。
 *
 * 这个接口会真的打厂商 API，所以先过 getOrCreateUser 拿到设备身份，
 * 不做成完全匿名的白嫖入口。返回的值只是给表单填默认值，
 * 创建者随时可以改，真正的校验在建活动那步的 validatePolicy。
 */
export async function POST(request: Request) {
  try {
    await getOrCreateUser();
    const body = await request.json();
    return Response.json(
      await suggestPolicy({
        title: String(body.title ?? "").slice(0, 100),
        sceneType: String(body.sceneType ?? "other").slice(0, 40),
        sceneDesc: String(body.sceneDesc ?? ""),
        participantCount: Number(body.participantCount) || 0,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
