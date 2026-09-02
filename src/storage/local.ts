import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { SignedUpload, StoragePort } from "./types";

/**
 * 签名密钥。
 *
 * 进程启动时随机生成，所以**进程重启后所有未过期的签名 URL 立刻失效**。
 * 单进程开发环境可以接受（TTL 才 5 分钟），但生产必须从环境变量读，
 * 多实例部署更是必须 —— 否则实例 A 签的 URL 到实例 B 验不过。
 * M7 部署时处理。
 */
const signingSecret = process.env.STORAGE_SIGNING_SECRET
  ? Buffer.from(process.env.STORAGE_SIGNING_SECRET, "utf8")
  : randomBytes(32);

type SignedOperation = "upload" | "download";

function signatureFor(operation: SignedOperation, key: string, expiresAt: string, mime: string): string {
  return createHmac("sha256", signingSecret)
    .update(`${operation}\n${key}\n${expiresAt}\n${mime}`)
    .digest("hex");
}

function signedUrl(operation: SignedOperation, key: string, expiresAt: Date, mime = ""): string {
  const params = new URLSearchParams({
    key,
    expires: expiresAt.getTime().toString(),
    mime,
    signature: signatureFor(operation, key, expiresAt.getTime().toString(), mime),
  });
  return `local-storage://${operation}?${params}`;
}

function safePath(root: string, key: string): string {
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("storage key 超出本地存储目录");
  }
  return target;
}

export function verifyLocalSignature(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "local-storage:" || !["upload", "download"].includes(parsed.hostname)) {
      return false;
    }

    const key = parsed.searchParams.get("key");
    const expires = parsed.searchParams.get("expires");
    const mime = parsed.searchParams.get("mime") ?? "";
    const signature = parsed.searchParams.get("signature");
    if (key === null || expires === null || signature === null || Date.now() > Number(expires)) {
      return false;
    }

    const expected = signatureFor(parsed.hostname as SignedOperation, key, expires, mime);
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export class LocalStorage implements StoragePort {
  private readonly root: string;

  constructor(root = ".storage") {
    this.root = resolve(root);
  }

  async signUpload(key: string, mime: string, ttlMs: number): Promise<SignedUpload> {
    await mkdir(this.root, { recursive: true });
    const expiresAt = new Date(Date.now() + ttlMs);
    return {
      url: signedUrl("upload", key, expiresAt, mime),
      key,
      expiresAt,
      headers: { "content-type": mime },
    };
  }

  async signDownload(key: string, ttlMs: number): Promise<string> {
    await mkdir(this.root, { recursive: true });
    return signedUrl("download", key, new Date(Date.now() + ttlMs));
  }

  async delete(key: string): Promise<void> {
    await rm(safePath(this.root, key), { force: true });
  }
}
