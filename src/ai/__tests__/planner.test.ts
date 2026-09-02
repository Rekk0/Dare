import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_VIDEO_FRAMES, planMedia } from "../planner";
import { MockProvider, MOCK_CAPS } from "../adapters/mock";
import type { MediaRef, ProviderCapabilities } from "../types";

const ref = (over: Partial<MediaRef> = {}): MediaRef => ({
  storageKey: "k",
  mime: "image/jpeg",
  bytes: 1000,
  ...over,
});

/** 照 Claude 的能力：只吃 text/image/PDF，音频要 ASR，视频要抽帧 */
const claudeLike: ProviderCapabilities = {
  ...MOCK_CAPS,
  id: "claude-like",
  media: { image: "native", audio: "transcode", video: "frames" },
};

describe("planMedia", () => {
  it("原生支持时内联", () => {
    const plan = planMedia([{ kind: "image", ref: ref() }], MOCK_CAPS);
    expect(plan.hasReject).toBe(false);
    expect(plan.actions[0]).toMatchObject({ kind: "inline" });
    expect(plan.records[0]).toMatchObject({ support: "native", parts: 1 });
  });

  it("超过内联上限且支持 file upload 时走上传", () => {
    const plan = planMedia(
      [{ kind: "video", ref: ref({ mime: "video/mp4", bytes: 20 * 1024 * 1024 }) }],
      MOCK_CAPS,
    );
    expect(plan.actions[0]).toMatchObject({ kind: "upload" });
  });

  it("超过内联上限但没有 file upload 时拒绝", () => {
    const noUpload = { ...MOCK_CAPS, fileUpload: false };
    const plan = planMedia(
      [{ kind: "video", ref: ref({ bytes: 20 * 1024 * 1024 }) }],
      noUpload,
    );
    expect(plan.hasReject).toBe(true);
    expect(plan.actions[0]).toMatchObject({ kind: "reject" });
  });

  it("不吃视频的厂商走抽帧，不吃音频的走 ASR", () => {
    const plan = planMedia(
      [
        { kind: "video", ref: ref({ mime: "video/mp4", durationMs: 30_000 }) },
        { kind: "audio", ref: ref({ mime: "audio/m4a", durationMs: 20_000 }) },
      ],
      claudeLike,
    );
    expect(plan.hasReject).toBe(false);
    expect(plan.actions[0]).toMatchObject({ kind: "extractFrames", frames: MAX_VIDEO_FRAMES });
    expect(plan.actions[1]).toMatchObject({ kind: "transcribe" });
    // 转写不占图片额度，所以只有抽帧算 parts
    expect(plan.records[0].parts).toBe(MAX_VIDEO_FRAMES);
    expect(plan.records[1].parts).toBe(1);
  });

  it("超时长的媒体截断而不是整个拒掉", () => {
    // 证据的前 N 秒通常已经够判，截断比拒收好
    const plan = planMedia(
      [{ kind: "video", ref: ref({ durationMs: 999_000 }) }],
      claudeLike,
    );
    expect(plan.actions[0]).toMatchObject({
      kind: "extractFrames",
      truncatedToSeconds: claudeLike.limits.maxVideoSeconds,
    });
  });

  it("图片额度是全局的，原生图片和抽帧共用", () => {
    const tight: ProviderCapabilities = {
      ...claudeLike,
      limits: { ...claudeLike.limits, maxImages: 3 },
    };
    const plan = planMedia(
      [
        { kind: "image", ref: ref() },
        { kind: "image", ref: ref() },
        { kind: "video", ref: ref({ durationMs: 10_000 }) },
      ],
      tight,
    );
    // 两张原生图占掉 2，剩 1 个额度给抽帧
    expect(plan.records[2].parts).toBe(1);
    expect(plan.hasReject).toBe(false);
  });

  it("图片额度耗尽后拒绝", () => {
    const tight: ProviderCapabilities = {
      ...MOCK_CAPS,
      limits: { ...MOCK_CAPS.limits, maxImages: 1 },
    };
    const plan = planMedia(
      [
        { kind: "image", ref: ref() },
        { kind: "image", ref: ref() },
      ],
      tight,
    );
    expect(plan.actions[0]).toMatchObject({ kind: "inline" });
    expect(plan.actions[1]).toMatchObject({ kind: "reject" });
    expect(plan.hasReject).toBe(true);
  });

  it("完全不支持且无降级路径时拒绝", () => {
    const noVideo: ProviderCapabilities = {
      ...MOCK_CAPS,
      media: { image: "native", audio: "native", video: "unsupported" },
    };
    const plan = planMedia([{ kind: "video", ref: ref() }], noVideo);
    expect(plan.hasReject).toBe(true);
    expect((plan.actions[0] as { reason: string }).reason).toContain("不支持");
  });
});

describe("MockProvider", () => {
  const schema = z.object({ verdict: z.enum(["accept", "reject"]) });

  it("返回校验过的对象，不烧钱", async () => {
    const p = new MockProvider({ responses: ['{"verdict":"accept"}'] });
    const r = await p.complete({
      system: "s",
      parts: [{ type: "text", text: "t" }],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.data.verdict).toBe("accept");
    expect(r.usage.costUsd).toBe(0);
    expect(r.retries).toBe(0);
    expect(p.calls).toHaveLength(1);
  });

  it("能模拟脏输出触发重试", async () => {
    const p = new MockProvider({
      responses: ["抱歉", '{"verdict":"reject"}'],
      caps: { structuredOutput: "prompt_only" },
    });
    const r = await p.complete({
      system: "s",
      parts: [],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.data.verdict).toBe("reject");
    expect(r.retries).toBe(1);
  });

  it("带媒体时产出 mediaPlan 便于复盘", async () => {
    const p = new MockProvider({ responses: ['{"verdict":"accept"}'] });
    const r = await p.complete({
      system: "s",
      parts: [
        { type: "text", text: "看这个" },
        { type: "media", kind: "video", ref: ref({ mime: "video/mp4" }) },
      ],
      schema,
      maxOutputTokens: 100,
    });
    expect(r.mediaPlan).toHaveLength(1);
    expect(r.mediaPlan[0]).toMatchObject({ kind: "video", support: "native" });
  });
});
