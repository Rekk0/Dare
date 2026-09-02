/**
 * 厂商能力实测（Spike A）。
 *
 * providers.yaml 里的 caps 是**声明**，不是事实。厂商能力会随模型换代漂移，
 * 文档也未必跟得上。这个脚本拿真 key 各跑一次，打印**实测**矩阵并跟声明比对。
 *
 * 一句话：厂商到底支不支持视频，让代码去问，不靠文档也不靠记忆。
 *
 * 用法：
 *   在 .env.local 里填好 key，然后
 *   pnpm providers:check              # 测 providers.yaml 里全部配了 key 的
 *   pnpm providers:check dashscope    # 只测某一个
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { buildProvider, loadProvidersFile } from "../src/ai/registry";
import type { AiProvider, MediaKind, Part } from "../src/ai/types";

// 1x1 像素的 PNG。测的是「这家吃不吃图片这种 content part」，不是识图质量
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ANSWER = z.object({ ok: z.literal(true) });

interface ProbeResult {
  kind: MediaKind | "text";
  passed: boolean;
  detail: string;
  ms: number;
}

/** 手动加载 .env.local，免得为一个脚本引 dotenv */
function loadEnvLocal(): void {
  for (const f of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), f), "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i < 0) continue;
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim();
        if (v && !process.env[k]) process.env[k] = v;
      }
    } catch {
      // 文件不存在是正常的
    }
  }
}

async function probe(
  provider: AiProvider,
  kind: MediaKind | "text",
  parts: Part[],
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    await provider.complete({
      system:
        "你是一个连通性探针。无论收到什么，都只回一个 JSON 对象：{\"ok\": true}。不要输出别的。",
      parts,
      schema: ANSWER,
      maxOutputTokens: 64,
    });
    return { kind, passed: true, detail: "通过", ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind, passed: false, detail: msg.slice(0, 220), ms: Date.now() - t0 };
  }
}

async function checkProvider(id: string): Promise<void> {
  const file = loadProvidersFile();
  const cfg = file.providers[id];
  if (!cfg) {
    console.log(`\n${id}: providers.yaml 里没有这个 provider`);
    return;
  }

  let provider: AiProvider;
  try {
    provider = buildProvider(id, cfg);
  } catch (err) {
    console.log(`\n${id}: 跳过 ${err instanceof Error ? err.message : err}`);
    return;
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`${id}  model=${cfg.model ?? "?"}`);
  console.log("=".repeat(64));

  const results: ProbeResult[] = [];
  results.push(await probe(provider, "text", [{ type: "text", text: "回 {\"ok\":true}" }]));
  results.push(
    await probe(provider, "image", [
      { type: "text", text: "这是什么？回 {\"ok\":true}" },
      { type: "media", kind: "image", ref: { storageKey: TINY_PNG, mime: "image/png", bytes: 70 } },
    ]),
  );

  // 音频和视频没有内联样本，只能验证请求形状被接受。
  // 要测真文件的话把可访问 URL 填进环境变量。
  const audioUrl = process.env.PROBE_AUDIO_URL;
  const videoUrl = process.env.PROBE_VIDEO_URL;

  if (audioUrl) {
    results.push(
      await probe(provider, "audio", [
        { type: "text", text: "听到什么？回 {\"ok\":true}" },
        { type: "media", kind: "audio", ref: { storageKey: audioUrl, mime: "audio/mp4", bytes: 1000, durationMs: 3000 } },
      ]),
    );
  }
  if (videoUrl) {
    results.push(
      await probe(provider, "video", [
        { type: "text", text: "看到什么？回 {\"ok\":true}" },
        { type: "media", kind: "video", ref: { storageKey: videoUrl, mime: "video/mp4", bytes: 100000, durationMs: 3000 } },
      ]),
    );
  }

  console.log("\n实测结果：");
  for (const r of results) {
    console.log(
      `  ${r.passed ? "通过" : "失败"}  ${r.kind.padEnd(6)} ${String(r.ms).padStart(6)}ms  ${r.passed ? "" : r.detail}`,
    );
  }

  // 跟声明比对。声明说支持但实测失败，就是声明错了，要改 providers.yaml
  const declared = cfg.caps?.media;
  if (declared) {
    const mismatches = results
      .filter((r): r is ProbeResult & { kind: MediaKind } => r.kind !== "text")
      .filter((r) => declared[r.kind] === "native" && !r.passed);
    if (mismatches.length) {
      console.log("\n声明与实测不符（providers.yaml 需要修正）：");
      for (const m of mismatches) {
        console.log(`  ${m.kind}: 声明 native，实测失败`);
      }
    } else {
      console.log("\n声明与实测一致");
    }
  }

  if (!audioUrl || !videoUrl) {
    console.log(
      "\n提示：音频/视频探针需要可公网访问的样本 URL，设 PROBE_AUDIO_URL / PROBE_VIDEO_URL 后重跑。",
    );
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const only = process.argv[2];
  const file = loadProvidersFile();
  const ids = only ? [only] : Object.keys(file.providers).filter((k) => k !== "mock");

  console.log("厂商能力实测。声明在 providers.yaml，事实以本次输出为准。");
  for (const id of ids) await checkProvider(id);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
