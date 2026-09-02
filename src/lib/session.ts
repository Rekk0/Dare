import { createHash, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
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
}

async function defaultDeps(): Promise<SessionDeps> {
  const store = await cookies();
  const client = await db;
  return {
    getCookie: async () => store.get(COOKIE)?.value,
    setCookie: async (token) => { store.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" }); },
    findUser: async (tokenHash) => (await client.select({ id: users.id }).from(users).where(eq(users.deviceTokenHash, tokenHash)))[0]?.id,
    createUser: async (token) => {
      const id = nanoid();
      await client.insert(users).values({ id, nickname: `玩家${randomInt(1000, 10000)}`, deviceTokenHash: hash(token), recoveryCode: String(randomInt(0, 1_000_000)).padStart(6, "0") });
      return id;
    },
    findParticipant: async (activityId, userId) => (await client.select({ id: participants.id }).from(participants).where(and(eq(participants.activityId, activityId), eq(participants.userId, userId))))[0]?.id,
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
  if (!pid) throw new Error("非参与者");
  return { userId, pid };
}

export async function requireParticipant(activityId: string): Promise<{ userId: string; pid: string }> {
  return requireParticipantWith(activityId, await defaultDeps());
}
