import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  REVIEW_TOKEN_TTL_MS,
  readReviewToken,
  signReviewToken,
  type ReviewTokenClaims,
} from "../review-token";

const secret = Buffer.from("test-secret-32-bytes-long-000000", "utf8");
const now = 1_700_000_000_000;
const claims: ReviewTokenClaims = { activityId: "act-1", pid: "pid-1", content: "一道正常的题" };
const scores = { feasibility: 80, stealth: 70, fun: 60, verifiability: 50, safety: "ok" };
const sign = (c = claims, s: unknown = scores) => signReviewToken(secret, c, s, now);

describe("预审凭据", () => {
  it("原样验证通过，评分原封不动带回来", () => {
    expect(readReviewToken(secret, sign(), claims, now)).toEqual({ scores });
  });

  it("正文被换掉就不认", () => {
    // 这条是这个模块存在的理由：拿正常题过预审，确认时换成被拦的内容
    expect(readReviewToken(secret, sign(), { ...claims, content: "换成被拦的内容" }, now)).toBeNull();
  });

  it("换个人或换个活动都不认", () => {
    expect(readReviewToken(secret, sign(), { ...claims, pid: "pid-2" }, now)).toBeNull();
    expect(readReviewToken(secret, sign(), { ...claims, activityId: "act-2" }, now)).toBeNull();
  });

  it("篡改评分段就不认，改不了入库的分数", () => {
    const token = sign();
    const [exp, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...scores, feasibility: 100 }), "utf8").toString("base64url");
    expect(readReviewToken(secret, `${exp}.${forged}.${sig}`, claims, now)).toBeNull();
  });

  it("过期不认", () => {
    const token = sign();
    expect(readReviewToken(secret, token, claims, now + REVIEW_TOKEN_TTL_MS - 1)).not.toBeNull();
    expect(readReviewToken(secret, token, claims, now + REVIEW_TOKEN_TTL_MS)).toBeNull();
  });

  it("改过期时间戳延不了期", () => {
    const [, scoresB64, sig] = sign().split(".");
    expect(readReviewToken(secret, `${now + 10 * REVIEW_TOKEN_TTL_MS}.${scoresB64}.${sig}`, claims, now)).toBeNull();
  });

  it("换密钥不认", () => {
    expect(readReviewToken(randomBytes(32), sign(), claims, now)).toBeNull();
  });

  it("畸形凭据不抛异常，一律返回 null", () => {
    for (const bad of ["", ".", "..", "abc", "a.b.c", `${now + 1000}..`, `x.y.${"0".repeat(64)}`]) {
      expect(readReviewToken(secret, bad, claims, now)).toBeNull();
    }
  });

  it("任意两组不同的 claims 签出的凭据互不通用", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.string(),
        fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.string(),
        (a1, p1, c1, a2, p2, c2) => {
          const one: ReviewTokenClaims = { activityId: a1, pid: p1, content: c1 };
          const two: ReviewTokenClaims = { activityId: a2, pid: p2, content: c2 };
          const same = a1 === a2 && p1 === p2 && c1 === c2;
          expect(readReviewToken(secret, sign(one), two, now) !== null).toBe(same);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
