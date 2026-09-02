import { randomBytes } from "node:crypto";

import type { ActivityStatus } from "./visibility";

export const ALLOWED_MIME = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/mp4", "audio/mpeg", "audio/webm"],
  video: ["video/mp4", "video/webm"],
} as const;

export const MAX_BYTES = {
  image: 10 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 200 * 1024 * 1024,
} as const;

export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
export const MAX_EVIDENCE_PER_ASSIGNMENT = 5;

export type EvidenceKind = keyof typeof ALLOWED_MIME;

/**
 * mime 到扩展名的映射。
 *
 * 存在的意义是**取消「调用方自由传扩展名」这个输入**，而不是事后过滤它。
 * 扩展名一旦可由调用方自由指定，`../../../evil` 这类值就能把 storage key
 * 指到存储目录之外。mime 本来就已经过白名单，从它推导扩展名，
 * 「非法扩展名」这种输入根本不存在，比任何事后清洗都可靠。
 */
export const EXT_OF_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function kindOfMime(mime: string): EvidenceKind | null {
  for (const [kind, mimes] of Object.entries(ALLOWED_MIME) as [
    EvidenceKind,
    readonly string[],
  ][]) {
    if (mimes.includes(mime)) return kind;
  }
  return null;
}

export interface UploadRequest {
  mime: string;
  bytes: number;
  requesterPid: string;
  assigneePid: string;
  activityStatus: ActivityStatus;
  existingEvidenceCount: number;
}

export type UploadDenial =
  | { reason: "not_assignee" }
  | { reason: "wrong_phase" }
  | { reason: "bad_mime"; mime: string }
  | { reason: "too_large"; limit: number }
  | { reason: "too_many"; limit: number };

export type UploadCheck =
  | { ok: true; kind: EvidenceKind }
  | { ok: false; denial: UploadDenial };

export function checkUpload(req: UploadRequest): UploadCheck {
  if (req.requesterPid !== req.assigneePid) {
    return { ok: false, denial: { reason: "not_assignee" } };
  }
  if (req.activityStatus !== "running") {
    return { ok: false, denial: { reason: "wrong_phase" } };
  }

  const kind = kindOfMime(req.mime);
  if (kind === null) {
    return { ok: false, denial: { reason: "bad_mime", mime: req.mime } };
  }
  // 负数和 NaN 都会绕过下面的上限比较（`-1 > limit` 和 `NaN > limit` 都是 false）
  if (!Number.isFinite(req.bytes) || req.bytes <= 0) {
    return { ok: false, denial: { reason: "too_large", limit: MAX_BYTES[kind] } };
  }
  if (req.bytes > MAX_BYTES[kind]) {
    return { ok: false, denial: { reason: "too_large", limit: MAX_BYTES[kind] } };
  }
  if (req.existingEvidenceCount >= MAX_EVIDENCE_PER_ASSIGNMENT) {
    return {
      ok: false,
      denial: { reason: "too_many", limit: MAX_EVIDENCE_PER_ASSIGNMENT },
    };
  }
  return { ok: true, kind };
}

/**
 * 生成不可枚举的 storage key。
 *
 * 扩展名**从已校验的 mime 推导**，不接受调用方传入：自由传扩展名的话，
 * `../../../evil` 这类值就能把 key 指到存储目录之外。取消这个输入
 * 比事后清洗它可靠。
 *
 * key 里**不放任何身份信息**，只有随机段和扩展名。放了 activityId 之类的话，
 * 拿到一个 key 就能反推它属于哪一局。按活动批量删除靠查 evidences 表拿 key，
 * 不需要靠路径前缀。
 */
export function buildStorageKey(mime: string): string {
  const ext = EXT_OF_MIME[mime];
  if (!ext) {
    throw new Error(`不支持的 mime: ${mime}，无法推导扩展名`);
  }
  return `${randomBytes(16).toString("hex")}.${ext}`;
}
