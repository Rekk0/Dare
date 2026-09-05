import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { SignedUpload, StoragePort } from "./types";

/**
 * 签名密钥。
 *
 * 进程启动时随机生成，所以**进程重启后所有未过期的签名 URL 立刻失效**。
 * 单进程开发环境可以接受（TTL 才 5 分钟），但生产必须从环境变量读，
 * 多实例部署更是必须 - 否则实例 A 签的 URL 到实例 B 验不过。
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
    exp: expiresAt.getTime().toString(),
    sig: signatureFor(operation, key, expiresAt.getTime().toString(), mime),
  });
  const path = `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}?${params}`;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function safePath(root: string, key: string): string {
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("storage key 超出本地存储目录");
  }
  return target;
}

export function verifyLocalSignature(
  operation: SignedOperation,
  key: string,
  expires: string | null,
  mime: string,
  signature: string | null,
  now = Date.now(),
): boolean {
  try {
    if (expires === null || signature === null || !Number.isFinite(Number(expires)) || now > Number(expires)) {
      return false;
    }

    const expected = signatureFor(operation, key, expires, mime);
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function localStoragePath(key: string, root = ".storage"): string {
  return safePath(resolve(root), key);
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
