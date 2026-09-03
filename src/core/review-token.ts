import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 预审凭据。
 *
 * **预审不写库。** 用户点「提交并预审」时只是在问 AI 一句意见，还没决定要不要交，
 * 这一步产生任何持久化都是错的。但确认那一步得由客户端把正文再发一遍，
 * 于是有个绕过口子：拿一道正常的题过预审，确认时换成被 block 的内容。
 *
 * 所以预审通过时签一张凭据，按住「哪个活动、哪个人、哪段正文」。
 * 确认时验签，正文对不上就不认。**判成 reject 的题不发凭据**，
 * 拿不到凭据就交不上去 - 安全线靠签名守，不靠往库里写一行草稿。
 *
 * 评分也装在凭据里由服务端自己解出来，不让客户端回传 -
 * 回传的话入库的就是客户端说了算的数字，那份记录以后查问题就不可信了。
 *
 * 这里是纯函数：密钥和当前时间都从参数进来，可以穷举验证。
 */

/** 凭据有效期。够用户看完评分再决定，又不至于长到能拿去慢慢试 */
export const REVIEW_TOKEN_TTL_MS = 15 * 60_000;

export interface ReviewTokenClaims {
  activityId: string;
  pid: string;
  content: string;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function signature(secret: Buffer, claims: ReviewTokenClaims, expiresAt: number, scoresB64: string): string {
  // 每段都带上长度再拼，避免「a」+「bc」和「ab」+「c」签出同一个值
  const parts = [String(expiresAt), scoresB64, claims.activityId, claims.pid, claims.content];
  const payload = parts.map((p) => `${p.length}:${p}`).join("\n");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signReviewToken(
  secret: Buffer,
  claims: ReviewTokenClaims,
  scores: unknown,
  now: number,
): string {
  const expiresAt = now + REVIEW_TOKEN_TTL_MS;
  const scoresB64 = b64(JSON.stringify(scores ?? null));
  return `${expiresAt}.${scoresB64}.${signature(secret, claims, expiresAt, scoresB64)}`;
}

/** 验不过一律返回 null，不抛异常。畸形输入是常态，不是意外 */
export function readReviewToken(
  secret: Buffer,
  token: string,
  claims: ReviewTokenClaims,
  now: number,
): { scores: unknown } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiresRaw, scoresB64, provided] = parts;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const expected = signature(secret, claims, expiresAt, scoresB64);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;

  try {
    return { scores: JSON.parse(Buffer.from(scoresB64, "base64url").toString("utf8")) };
  } catch {
    return null;
  }
}
