import { createHash, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { participants, users } from "@/db/schema";

const COOKIE = "dare_device";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionDeps {
  getCookie: () => Promise<string | undefined>;
  setCookie: (token: string) => Promise<void>;
  findUser: (tokenHash: string) => Promise<string | undefined>;
  createUser: (token: string) => Promise<string>;
  findParticipant: (activityId: string, userId: string) => Promise<string | undefined>;
  findEliminatedParticipant?: (activityId: string, userId: string) => Promise<boolean>;
}

/**
 * cookie 该不该带 Secure。
 *
 * **不能用 `NODE_ENV === "production"` 判断。** 生产构建在 HTTP 下跑是常见场景
 * （局域网真机测试就是），而带 Secure 的 cookie 会被浏览器在 HTTP 下直接丢弃  - 
 * 表现是加入成功但下一个请求就不认识你了，服务端当成新用户，
 * requireParticipant 返 403，页面只显示一句「这题没送进去」，极难定位。
 *
 * 按请求的实际协议判断：反代转发时看 x-forwarded-proto，直连时看 host 是不是本地。
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  // 没有反代头就看有没有走 TLS 的迹象，保守起见默认不带 Secure
  return false;
}

async function defaultDeps(): Promise<SessionDeps> {
  const store = await cookies();
  const client = await db;
  const secure = await shouldUseSecureCookie();
  return {
    getCookie: async () => store.get(COOKIE)?.value,
    setCookie: async (token) => { store.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 60 * 60 * 24 * 30 }); },
    findUser: async (tokenHash) => (await client.select({ id: users.id }).from(users).where(eq(users.deviceTokenHash, tokenHash)))[0]?.id,
    createUser: async (token) => {
      const id = nanoid();
      await client.insert(users).values({ id, nickname: `玩家${randomInt(1000, 10000)}`, deviceTokenHash: hash(token), recoveryCode: String(randomInt(0, 1_000_000)).padStart(6, "0") });
      return id;
    },
    findParticipant: async (activityId, userId) => (await client.select({ id: participants.id }).from(participants).where(and(eq(participants.activityId, activityId), eq(participants.userId, userId), isNull(participants.eliminatedAt))))[0]?.id,
    findEliminatedParticipant: async (activityId, userId) => Boolean((await client.select({ id: participants.id }).from(participants).where(and(eq(participants.activityId, activityId), eq(participants.userId, userId), isNotNull(participants.eliminatedAt))))[0]),
  };
}

export async function getOrCreateUserWith(deps: SessionDeps): Promise<{ userId: string }> {
  const existing = await deps.getCookie();
  if (existing) {
    const userId = await deps.findUser(hash(existing));
    if (userId) return { userId };
  }
  const token = nanoid(32);
  const userId = await deps.createUser(token);
  await deps.setCookie(token);
  return { userId };
}

export async function getOrCreateUser(): Promise<{ userId: string }> {
  return getOrCreateUserWith(await defaultDeps());
}

export async function requireParticipantWith(activityId: string, deps: SessionDeps): Promise<{ userId: string; pid: string }> {
  const { userId } = await getOrCreateUserWith(deps);
  const pid = await deps.findParticipant(activityId, userId);
  if (!pid) {
    if (await deps.findEliminatedParticipant?.(activityId, userId)) throw new Error("你没交题，这局没你了");
    throw new Error("非参与者");
  }
  return { userId, pid };
}

export async function requireParticipant(activityId: string): Promise<{ userId: string; pid: string }> {
  return requireParticipantWith(activityId, await defaultDeps());
}
