import { planMedia, type MediaAction } from "../planner";
import type {
  AiProvider,
  AiRequest,
  AiResult,
  MediaKind,
  MediaRef,
  ProviderCapabilities,
} from "../types";
import { parseAndValidate } from "../validate";

/**
 * OpenAI 兼容端点的适配器。
 *
 * 这一个 adapter 覆盖阿里百炼、智谱、硅基流动、DeepSeek、Moonshot 等一大片 ：
 * 国内多数厂商都提供 OpenAI 兼容接口，写一个加一份 baseUrl 配置就够，
 * 不用一家写一个。
 *
 * 它只做一件事：把归一化的 AiRequest 翻成这家的 wire format。
 * 媒体该原样传还是抽帧还是转写，是 MediaPlanner 的事，不在这里判断。
 */

/** 各家对多模态 content part 的叫法不完全一致，做成可配置的 */
export interface ContentPartNames {
  image: string;
  audio: string;
  video: string;
}

export const DEFAULT_PART_NAMES: ContentPartNames = {
  image: "image_url",
  audio: "input_audio",
  video: "video_url",
};

export interface OpenAiCompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  caps: ProviderCapabilities;
  /**
   * 一律用流式。omni 系模型有的强制要求流式，而流式在不要求时也一样能用，
   * 且长多模态请求不会撞 HTTP 超时。没有理由不开。
   */
  stream?: boolean;
  partNames?: ContentPartNames;
  /** 便于测试注入。生产用全局 fetch */
  fetchImpl?: typeof fetch;
  /** 媒体的可访问 URL。M4 接对象存储后由预签名 URL 提供 */
  resolveMediaUrl?: (ref: MediaRef) => Promise<string>;
  /**
   * 单次请求超时。多模态请求本来就慢，默认给足。
   * 必须显式设：不设的话慢连接会静默拖死，而 fetch 只抛一个
   * 没有信息量的 `fetch failed`，底层原因被吞掉。
   */
  timeoutMs?: number;
  /**
   * 建连失败时重试几次。
   * 厂商域名的 A 记录里可能混着不可达的地址（实测阿里百炼的 workspace
   * 端点两个 A 记录里有一个是死的），配合 net.ts 里随机化的 DNS 顺序，
   * 重试就能换一个地址。只对建连类错误重试，HTTP 错误不重试。
   */
  connectRetries?: number;
}

type ContentPart = Record<string, unknown>;

function mediaPart(
  kind: MediaKind,
  url: string,
  names: ContentPartNames,
): ContentPart {
  switch (kind) {
    case "image":
      return { type: names.image, [names.image]: { url } };
    case "video":
      return { type: names.video, [names.video]: { url } };
    case "audio":
      // 音频这一档各家差异最大，有的要 {data, format}，有的接 url。
      // 先按 url 形态发，providers:check 会实测出来对不对。
      return { type: names.audio, [names.audio]: { url } };
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly caps: ProviderCapabilities;
  private readonly opts: Required<
    Pick<OpenAiCompatibleOptions, "baseUrl" | "apiKey" | "model" | "stream">
  > &
    OpenAiCompatibleOptions;
  private readonly names: ContentPartNames;
  private readonly doFetch: typeof fetch;

  constructor(opts: OpenAiCompatibleOptions) {
    if (!opts.apiKey) {
      throw new Error(`provider ${opts.id} 缺少 API key（检查 .env.local）`);
    }
    this.caps = opts.caps;
    this.opts = { stream: true, ...opts } as typeof this.opts;
    this.names = opts.partNames ?? DEFAULT_PART_NAMES;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async buildContent(req: AiRequest<unknown>): Promise<ContentPart[]> {
    const media = req.parts
      .filter((p): p is Extract<typeof p, { type: "media" }> => p.type === "media")
      .map((p) => ({ kind: p.kind, ref: p.ref }));
    const plan = planMedia(media, this.caps);

    if (plan.hasReject) {
      const why = plan.actions
        .filter((a): a is Extract<MediaAction, { kind: "reject" }> => a.kind === "reject")
        .map((a) => a.reason)
        .join("; ");
      throw new Error(`${this.opts.id} 无法处理这些媒体: ${why}`);
    }

    const content: ContentPart[] = [];
    let mediaIdx = 0;
    for (const part of req.parts) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
        continue;
      }
      const action = plan.actions[mediaIdx++];
      // 抽帧和转写要先经过 worker，adapter 拿到的应当已经是处理好的产物。
      // 走到这里还是这两种，说明调用方跳过了 MediaPlanner 的执行阶段。
      if (action.kind === "extractFrames" || action.kind === "transcribe") {
        throw new Error(
          `${this.opts.id} 需要先对 ${part.kind} 做降级处理（${action.kind}），` +
            `adapter 不负责执行降级，见 ARCHITECTURE.md §4`,
        );
      }
      const url = this.opts.resolveMediaUrl
        ? await this.opts.resolveMediaUrl(part.ref)
        : part.ref.storageKey;
      content.push(mediaPart(part.kind, url, this.names));
    }
    return content;
  }

  private async call(
    content: ContentPart[],
    system: string,
    maxTokens: number,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      max_tokens: maxTokens,
      stream: this.opts.stream,
    };
    // json_mode 档的厂商能强制返回合法 JSON，能用就用，省掉一轮重试
    if (this.caps.structuredOutput !== "prompt_only") {
      body.response_format = { type: "json_object" };
    }
    if (this.opts.stream) {
      body.stream_options = { include_usage: true };
    }

    const attempts = (this.opts.connectRetries ?? 3) + 1;
    let res: Response | null = null;
    let lastErr = "";

    for (let i = 0; i < attempts; i++) {
      try {
        res = await this.doFetch(`${this.opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
        });
        break;
      } catch (err) {
        // fetch 的网络错误把底层原因藏在 cause 里，不挖出来就只有
        // 一句没用的 `fetch failed`
        const e = err as Error & { cause?: unknown };
        const cause = e.cause instanceof Error ? e.cause.message : e.message;
        lastErr = cause;
        // 只对建连类错误重试。HTTP 层的错误重试没有意义
        const retryable = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(
          cause,
        );
        if (!retryable || i === attempts - 1) {
          throw new Error(
            `${this.opts.id} 请求失败 (${this.opts.baseUrl}) 第 ${i + 1}/${attempts} 次: ${cause}`,
          );
        }
      }
    }
    if (!res) throw new Error(`${this.opts.id} 请求失败: ${lastErr}`);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `${this.opts.id} HTTP ${res.status}: ${text.slice(0, 400)}`,
      );
    }

    return this.opts.stream ? readStream(res) : readJson(res);
  }

  async complete<T>(req: AiRequest<T>): Promise<AiResult<T>> {
    const content = await this.buildContent(req as AiRequest<unknown>);
    const media = req.parts
      .filter((p): p is Extract<typeof p, { type: "media" }> => p.type === "media")
      .map((p) => ({ kind: p.kind, ref: p.ref }));
    const plan = planMedia(media, this.caps);

    const first = await this.call(content, req.system, req.maxOutputTokens);

    const { data, raw, retries } = await parseAndValidate(
      req.schema,
      first,
      this.caps.structuredOutput,
      // 重试时把问题回喂给模型，而不是原样再问一遍
      async (problem) =>
        this.call(
          [...content, { type: "text", text: `上次的输出有问题：${problem}。请只输出合法 JSON。` }],
          req.system,
          req.maxOutputTokens,
        ),
    );

    return {
      data,
      raw,
      usage: {},
      provider: this.opts.id,
      model: this.opts.model,
      mediaPlan: plan.records,
      retries,
    };
  }
}

/** 厂商在 SSE 流里回的 API 错误。跟半个 JSON 的解析失败区分开 */
class StreamApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamApiError";
  }
}

async function readJson(res: Response): Promise<string> {
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** 把 SSE 流拼回完整文本。各家的 delta 形状一致，这段可以复用 */
async function readStream(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE 以空行分隔事件。必须按行切并保留半行，
    // 一个 chunk 里可能只到半个 JSON。
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string; code?: string };
        };
        // 厂商会把 API 错误也塞进 SSE 流里（HTTP 状态仍是 200）。
        // 不在这里抛出来的话，错误会被静默丢弃，最后表现成
        // 「找不到合法 JSON」这种毫无信息量的解析失败。
        if (j.error) {
          throw new StreamApiError(
            j.error.message ?? j.error.code ?? "厂商在流中返回了未知错误",
          );
        }
        out += j.choices?.[0]?.delta?.content ?? "";
      } catch (e) {
        if (e instanceof StreamApiError) throw e;
        // 半个 JSON，忽略。完整的那份会在后续 chunk 里补齐
      }
    }
  }
  return out;
}
