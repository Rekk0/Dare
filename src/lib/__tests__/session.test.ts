import { describe, expect, it } from "vitest";
import { getOrCreateUserWith, requireParticipantWith, type SessionDeps } from "@/lib/session";

function deps(): SessionDeps & { cookie?: string; users: Map<string, string> } {
  const state = { cookie: undefined as string | undefined, users: new Map<string, string>() };
  return Object.assign(state, {
    getCookie: async () => state.cookie,
    setCookie: async (token: string) => { state.cookie = token; },
    findUser: async (tokenHash: string) => state.users.get(tokenHash),
    createUser: async (token: string) => { const id = `u${state.users.size + 1}`; const { createHash } = await import("node:crypto"); state.users.set(createHash("sha256").update(token).digest("hex"), id); return id; },
    findParticipant: async () => undefined,
  });
}
describe("设备身份", () => {
  it("cookie 缺失时创建用户", async () => { const d = deps(); await expect(getOrCreateUserWith(d)).resolves.toEqual({ userId: "u1" }); expect(d.cookie).toBeTruthy(); });
  it("同一 cookie 复用同一 userId", async () => { const d = deps(); const first = await getOrCreateUserWith(d); await expect(getOrCreateUserWith(d)).resolves.toEqual(first); });
  it("非参与者拒绝访问活动", async () => { await expect(requireParticipantWith("a1", deps())).rejects.toThrow("非参与者"); });
});
