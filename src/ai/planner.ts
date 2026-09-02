import type {
  MediaKind,
  MediaPlanRecord,
  MediaRef,
  Part,
  ProviderCapabilities,
  Support,
} from "./types";

/**
 * MediaPlanner：读 provider 的能力声明，把原始媒体规划成这家能吃的形式。
 *
 * 降级逻辑放这里，不放 adapter。否则每加一家厂商都要重写一遍抽帧和 ASR。
 * Adapter 只负责把归一化请求翻成那家的 wire format，保持薄。
 *
 * 这个模块是纯函数：只产出「该怎么做」的计划，不真的调 ffmpeg 或 ASR。
 * 执行计划的是 worker，这样规划逻辑本身可以被穷举测试。
 */

/** 一个媒体要怎么处理 */
export type MediaAction =
  | { kind: "inline"; ref: MediaRef }
  /** 超过内联上限，得先传到厂商的 file API */
  | { kind: "upload"; ref: MediaRef }
  /** ffmpeg 抽帧，frames 是要抽几帧 */
  | { kind: "extractFrames"; ref: MediaRef; frames: number; truncatedToSeconds?: number }
  /** ASR 转写 */
  | { kind: "transcribe"; ref: MediaRef; truncatedToSeconds?: number }
  /** 这家吃不了，且没有降级路径 */
  | { kind: "reject"; ref: MediaRef; reason: string };

export interface MediaPlan {
  actions: MediaAction[];
  records: MediaPlanRecord[];
  /** 有 reject 时为 true，调用方应当换 provider 或报错 */
  hasReject: boolean;
}

/** 视频抽帧的上限。超过这个数一次请求会很贵，且边际信息量很低 */
export const MAX_VIDEO_FRAMES = 12;

function secondsOf(ref: MediaRef): number | undefined {
  return ref.durationMs === undefined ? undefined : ref.durationMs / 1000;
}

function planOne(
  kind: MediaKind,
  ref: MediaRef,
  caps: ProviderCapabilities,
  imageBudget: { left: number },
): { action: MediaAction; record: MediaPlanRecord } {
  const support: Support = caps.media[kind];

  if (support === "unsupported") {
    return {
      action: { kind: "reject", ref, reason: `${caps.id} 不支持 ${kind}，且无降级路径` },
      record: { kind, support, parts: 0, note: "rejected" },
    };
  }

  if (support === "native") {
    // 时长超限就截断。截断比整个拒掉好：证据的前 N 秒通常已经能判
    const secs = secondsOf(ref);
    const cap = kind === "video" ? caps.limits.maxVideoSeconds : caps.limits.maxAudioSeconds;
    const truncated = kind !== "image" && secs !== undefined && secs > cap ? cap : undefined;

    if (kind === "image") {
      if (imageBudget.left <= 0) {
        return {
          action: { kind: "reject", ref, reason: `超出 ${caps.id} 的图片数量上限` },
          record: { kind, support, parts: 0, note: "over maxImages" },
        };
      }
      imageBudget.left--;
    }

    const needsUpload = ref.bytes > caps.limits.maxInlineBytes;
    if (needsUpload && !caps.fileUpload) {
      return {
        action: { kind: "reject", ref, reason: `文件超过内联上限，且 ${caps.id} 没有 file upload` },
        record: { kind, support, parts: 0, note: "too large to inline" },
      };
    }

    return {
      action: needsUpload ? { kind: "upload", ref } : { kind: "inline", ref },
      record: {
        kind,
        support,
        parts: 1,
        note: [needsUpload ? "uploaded" : "inline", truncated ? `truncated ${truncated}s` : null]
          .filter(Boolean)
          .join(", "),
      },
    };
  }

  if (support === "frames") {
    const secs = secondsOf(ref);
    const truncated = secs !== undefined && secs > caps.limits.maxVideoSeconds
      ? caps.limits.maxVideoSeconds
      : undefined;
    const frames = Math.max(1, Math.min(MAX_VIDEO_FRAMES, imageBudget.left));
    if (imageBudget.left <= 0) {
      return {
        action: { kind: "reject", ref, reason: `抽帧需要图片额度，但 ${caps.id} 的额度已用尽` },
        record: { kind, support, parts: 0, note: "no image budget" },
      };
    }
    imageBudget.left -= frames;
    return {
      action: { kind: "extractFrames", ref, frames, truncatedToSeconds: truncated },
      record: { kind, support, parts: frames, note: `抽 ${frames} 帧` },
    };
  }

  // transcode: 转成文本，不占图片额度
  const secs = secondsOf(ref);
  const truncated = secs !== undefined && secs > caps.limits.maxAudioSeconds
    ? caps.limits.maxAudioSeconds
    : undefined;
  return {
    action: { kind: "transcribe", ref, truncatedToSeconds: truncated },
    record: { kind, support, parts: 1, note: "ASR 转写" },
  };
}

/**
 * 给定一组媒体和目标 provider 的能力，产出处理计划。
 *
 * 图片额度是全局的：原生图片和视频抽帧共用同一个 maxImages 预算，
 * 因为送到厂商那边它们都是 image part。先来先占。
 */
export function planMedia(
  media: { kind: MediaKind; ref: MediaRef }[],
  caps: ProviderCapabilities,
): MediaPlan {
  const imageBudget = { left: caps.limits.maxImages };
  const actions: MediaAction[] = [];
  const records: MediaPlanRecord[] = [];

  for (const m of media) {
    const { action, record } = planOne(m.kind, m.ref, caps, imageBudget);
    actions.push(action);
    records.push(record);
  }

  return { actions, records, hasReject: actions.some((a) => a.kind === "reject") };
}

/** 计划里非 reject 的媒体会展开成几个 part */
export function plannedPartCount(plan: MediaPlan): number {
  return plan.records.reduce((sum, r) => sum + r.parts, 0);
}

/** 便于把纯文本 part 和媒体计划拼起来 */
export function textPart(text: string): Part {
  return { type: "text", text };
}
