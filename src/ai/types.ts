/**
 * AI 层的归一化契约。三段式见 ARCHITECTURE.md §4。
 *
 * 业务层只构造 AiRequest，不知道底下是哪家厂商。
 * MediaPlanner 读 caps 决定媒体怎么喂。
 * ProviderAdapter 只把归一化请求翻成这家的 wire format，保持薄。
 */

import type { ZodType } from "zod";

export type MediaKind = "image" | "audio" | "video";

/** 该厂商对某种媒体的处理方式 */
export type Support =
  /** 直接吃 */
  | "native"
  /** 不吃，本地 ffmpeg 抽帧转成图片 */
  | "frames"
  /** 不吃，本地 ASR 转成文本 */
  | "transcode"
  /** 放弃 */
  | "unsupported";

/** 结构化输出的支持档位。三档降级见 validate.ts */
export type StructuredOutputTier = "json_schema" | "json_mode" | "prompt_only";

export interface ProviderLimits {
  maxImages: number;
  maxImageBytes: number;
  maxAudioSeconds: number;
  maxVideoSeconds: number;
  maxVideoBytes: number;
  /** 超过这个大小必须走该厂商的 file upload API，不能内联 */
  maxInlineBytes: number;
}

export interface ProviderCapabilities {
  id: string;
  media: Record<MediaKind, Support>;
  limits: ProviderLimits;
  structuredOutput: StructuredOutputTier;
  fileUpload: boolean;
}

/** 指向对象存储，字节不进内存 */
export interface MediaRef {
  storageKey: string;
  mime: string;
  bytes: number;
  durationMs?: number;
}

export type Part =
  | { type: "text"; text: string }
  | { type: "media"; kind: MediaKind; ref: MediaRef };

export type Effort = "low" | "medium" | "high";

export interface AiRequest<T> {
  system: string;
  parts: Part[];
  /** 期望的输出形状。三档降级都最终按它校验 */
  schema: ZodType<T>;
  /** 给 prompt_only 档用的 schema 文字描述，也用于 few-shot */
  schemaHint?: string;
  effort?: Effort;
  maxOutputTokens: number;
}

/** 实际怎么把媒体喂进去的。存进 ai_reports 便于复盘跨厂商的差异 */
export interface MediaPlanRecord {
  kind: MediaKind;
  support: Support;
  /** 降级后产生了几个 part（抽帧数量 / 转写段数），native 时为 1 */
  parts: number;
  note?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AiResult<T> {
  /** 已按 schema 校验过。业务层拿到的永远是合法对象 */
  data: T;
  raw: string;
  usage: AiUsage;
  provider: string;
  model: string;
  mediaPlan: MediaPlanRecord[];
  /** 校验失败重试了几次。持续 > 0 说明该厂商的结构化输出档位标高了 */
  retries: number;
}

export interface AiProvider {
  readonly caps: ProviderCapabilities;
  complete<T>(req: AiRequest<T>): Promise<AiResult<T>>;
}

/** 厂商返回的内容不合法且重试用尽 */
export class AiValidationError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "AiValidationError";
  }
}
