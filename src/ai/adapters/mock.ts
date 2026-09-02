import { planMedia } from "../planner";
import type {
  AiProvider,
  AiRequest,
  AiResult,
  MediaKind,
  ProviderCapabilities,
} from "../types";
import { parseAndValidate } from "../validate";

/**
 * MockProvider —— 不是可选项，是必需品。
 *
 * CI 和本地开发必须能跑通全部 AI 相关逻辑而不烧钱、不需要 key。
 * 开源项目尤其需要：贡献者 clone 下来就能跑测试。
 *
 * 它三种媒体全声明 native，这样 planner 的降级路径不会在 mock 下被触发；
 * 要测降级路径就自己造一个 caps 传给 planMedia，别改这里。
 */

export const MOCK_CAPS: ProviderCapabilities = {
  id: "mock",
  media: { image: "native", audio: "native", video: "native" },
  limits: {
    maxImages: 20,
    maxImageBytes: 8 * 1024 * 1024,
    maxAudioSeconds: 600,
    maxVideoSeconds: 300,
    maxVideoBytes: 64 * 1024 * 1024,
    maxInlineBytes: 4 * 1024 * 1024,
  },
  structuredOutput: "json_schema",
  fileUpload: true,
};

export interface MockOptions {
  /**
   * 按顺序返回的原始输出。用完之后循环使用最后一个。
   * 想测重试就给 ['不是 JSON', '{...}']。
   */
  responses: string[];
  /** 模拟延迟，默认 0 */
  delayMs?: number;
  caps?: Partial<ProviderCapabilities>;
}

export class MockProvider implements AiProvider {
  readonly caps: ProviderCapabilities;
  private readonly responses: string[];
  private readonly delayMs: number;
  private cursor = 0;
  /** 便于测试断言：记录每次收到的请求 */
  readonly calls: AiRequest<unknown>[] = [];

  constructor(opts: MockOptions) {
    if (opts.responses.length === 0) {
      throw new Error("MockProvider 至少需要一个 response");
    }
    this.responses = opts.responses;
    this.delayMs = opts.delayMs ?? 0;
    this.caps = { ...MOCK_CAPS, ...opts.caps, id: opts.caps?.id ?? "mock" };
  }

  private next(): string {
    const i = Math.min(this.cursor, this.responses.length - 1);
    this.cursor++;
    return this.responses[i];
  }

  async complete<T>(req: AiRequest<T>): Promise<AiResult<T>> {
    this.calls.push(req as AiRequest<unknown>);
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    const media = req.parts
      .filter((p): p is Extract<typeof p, { type: "media" }> => p.type === "media")
      .map((p) => ({ kind: p.kind as MediaKind, ref: p.ref }));
    const plan = planMedia(media, this.caps);

    const { data, raw, retries } = await parseAndValidate(
      req.schema,
      this.next(),
      this.caps.structuredOutput,
      async () => this.next(),
    );

    return {
      data,
      raw,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      provider: this.caps.id,
      model: "mock",
      mediaPlan: plan.records,
      retries,
    };
  }
}
