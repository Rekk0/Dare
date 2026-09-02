import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider } from "../adapters/openai-compatible";
import { MOCK_CAPS } from "../adapters/mock";
import type { ProviderCapabilities } from "../types";

const schema = z.object({ verdict: z.enum(["accept", "reject"]) });

const caps: ProviderCapabilities = {
  ...MOCK_CAPS,
  id: "fake",
  structuredOutput: "json_mode",
  fileUpload: false,
};

/** 造一个 SSE 流响应，验证流式拼接 */
function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

function delta(s: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
}

function make(fetchImpl: typeof fetch, over: Partial<ProviderCapabilities> = {}) {
  return new OpenAiCompatibleProvider({
    id: "fake",
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "qwen3.5-omni",
    caps: { ...caps, ...over },
    fetchImpl,
    resolveMediaUrl: async (r) => `https://cdn.test/${r.storageKey}`,
  });
}

describe("OpenAiCompatibleProvider", () => {
  it("缺 key 直接抛错，不要等到调用时才失败", () => {
    expect(
      () =>
        new OpenAiCompatibleProvider({
          id: "fake",
          baseUrl: "x",
          apiKey: "",
          model: "m",
          caps,
        }),
    ).toThrow(/缺少 API key/);
  });

  it("流式响应能拼回完整文本并校验", async () => {
    const f = vi.fn(async () =>
      sseResponse([delta('{"verd'), delta('ict":"acc'), delta('ept"}'), "data: [DONE]\n\n"]),
    ) as unknown as typeof fetch;

    const p = make(f);
    const r = await p.complete({
      system: "s",
      parts: [{ type: "text", text: "t" }],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.data.verdict).toBe("accept");
    expect(r.provider).toBe("fake");
  });

  it("SSE 事件被切在半个 JSON 上也能正确还原", async () => {
    // 一个 chunk 里可能只到半行，必须保留残行等后续补齐
    const full = delta('{"verdict":"reject"}');
    const cut = Math.floor(full.length / 2);
    const f = vi.fn(async () =>
      sseResponse([full.slice(0, cut), full.slice(cut), "data: [DONE]\n\n"]),
    ) as unknown as typeof fetch;

    const r = await make(f).complete({
      system: "s",
      parts: [],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.data.verdict).toBe("reject");
  });

  it("媒体被翻成各自的 content part 形状", async () => {
    let sent: Record<string, unknown> = {};
    const f = vi.fn(async (_url: unknown, init: unknown) => {
      sent = JSON.parse((init as RequestInit).body as string);
      return sseResponse([delta('{"verdict":"accept"}')]);
    }) as unknown as typeof fetch;

    await make(f).complete({
      system: "s",
      parts: [
        { type: "text", text: "看这个" },
        { type: "media", kind: "image", ref: { storageKey: "a.jpg", mime: "image/jpeg", bytes: 100 } },
        { type: "media", kind: "video", ref: { storageKey: "b.mp4", mime: "video/mp4", bytes: 100 } },
        { type: "media", kind: "audio", ref: { storageKey: "c.m4a", mime: "audio/mp4", bytes: 100 } },
      ],
      schema,
      maxOutputTokens: 100,
    });

    const content = (sent.messages as { content: { type: string }[] }[])[1].content;
    expect(content.map((c) => c.type)).toEqual([
      "text",
      "image_url",
      "video_url",
      "input_audio",
    ]);
    expect(sent.stream).toBe(true);
    // json_mode 档能强制合法 JSON，用上省一轮重试
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("HTTP 错误带上响应体，便于排查厂商侧的报错", async () => {
    const f = vi.fn(async () =>
      new Response("model not found: qwen3.5-omni", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      make(f).complete({ system: "s", parts: [], schema, maxOutputTokens: 10 }),
    ).rejects.toThrow(/HTTP 404[\s\S]*model not found/);
  });

  it("脏输出触发一次重试，且把问题回喂给模型", async () => {
    const bodies: string[] = [];
    let n = 0;
    const f = vi.fn(async (_u: unknown, init: unknown) => {
      bodies.push((init as RequestInit).body as string);
      n += 1;
      return sseResponse([delta(n === 1 ? "抱歉，我需要更多信息" : '{"verdict":"accept"}')]);
    }) as unknown as typeof fetch;

    const r = await make(f).complete({
      system: "s",
      parts: [{ type: "text", text: "t" }],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.retries).toBe(1);
    expect(bodies).toHaveLength(2);
    // 重试时把问题回喂回去，而不是原样再问一遍
    expect(bodies[1]).toContain("上次的输出有问题");
  });

  it("厂商吃不下的媒体直接报错，不静默丢弃", async () => {
    const f = vi.fn(async () => sseResponse([delta("{}")])) as unknown as typeof fetch;
    const p = make(f, {
      media: { image: "native", audio: "native", video: "unsupported" },
    });

    await expect(
      p.complete({
        system: "s",
        parts: [{ type: "media", kind: "video", ref: { storageKey: "v", mime: "video/mp4", bytes: 1 } }],
        schema,
        maxOutputTokens: 10,
      }),
    ).rejects.toThrow(/无法处理这些媒体/);
  });

  it("需要降级的媒体在 adapter 里报错，因为降级不是 adapter 的职责", async () => {
    const f = vi.fn(async () => sseResponse([delta("{}")])) as unknown as typeof fetch;
    const p = make(f, {
      media: { image: "native", audio: "transcode", video: "frames" },
    });

    await expect(
      p.complete({
        system: "s",
        parts: [{ type: "media", kind: "audio", ref: { storageKey: "a", mime: "audio/mp4", bytes: 1, durationMs: 5000 } }],
        schema,
        maxOutputTokens: 10,
      }),
    ).rejects.toThrow(/需要先对 audio 做降级处理/);
  });
});
