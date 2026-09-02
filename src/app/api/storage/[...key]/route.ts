import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

import { MAX_BYTES, kindOfMime } from "@/core/upload-policy";
import { localStoragePath, safePath, verifyLocalSignature } from "@/storage/local";

export const runtime = "nodejs";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg", ".weba": "audio/webm", ".mp4": "video/mp4", ".webm": "video/webm",
};

type Context = { params: Promise<{ key: string[] }> };

function keyFrom(params: { key: string[] }): string {
  return params.key.join("/");
}

function authorized(request: Request, operation: "upload" | "download", key: string, mime: string): boolean {
  const url = new URL(request.url);
  return verifyLocalSignature(operation, key, url.searchParams.get("exp"), mime, url.searchParams.get("sig"));
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const key = keyFrom(await context.params);
  const mime = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
  const kind = kindOfMime(mime);
  if (!authorized(request, "upload", key, mime)) return new Response("Forbidden", { status: 403 });
  if (kind === null) return new Response("Unsupported Media Type", { status: 415 });

  const limit = MAX_BYTES[kind];
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) return new Response("Payload Too Large", { status: 413 });

  const reader = request.body?.getReader();
  if (!reader) return new Response("Bad Request", { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > limit) return new Response("Payload Too Large", { status: 413 });
    chunks.push(part.value);
  }

  try {
    const path = localStoragePath(key);
    safePath(dirname(path), ".");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.concat(chunks));
    return new Response(null, { status: 201 });
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const key = keyFrom(await context.params);
  if (!authorized(request, "download", key, "")) return new Response("Forbidden", { status: 403 });

  try {
    const path = localStoragePath(key);
    const body = await readFile(path);
    return new Response(body, { headers: { "content-type": MIME_BY_EXTENSION[extname(key).toLowerCase()] ?? "application/octet-stream" } });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
