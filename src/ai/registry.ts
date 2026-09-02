import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { MockProvider, MOCK_CAPS } from "./adapters/mock";
import { OpenAiCompatibleProvider } from "./adapters/openai-compatible";
import type { AiProvider, ProviderCapabilities } from "./types";

/**
 * 读 providers.yaml，按场景取 provider。
 *
 * caps 由配置声明而不是硬编码在代码里 ：厂商能力会随模型换代漂移，
 * 硬编码就意味着每次漂移都要改代码。用 `pnpm providers:check` 实测校验声明。
 */

export type Route = "taskReview" | "evidenceReview" | "guessJudge";

interface ProviderConfig {
  adapter: "openai-compatible" | "mock";
  model?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  stream?: boolean;
  caps?: Partial<ProviderCapabilities> & {
    media?: ProviderCapabilities["media"];
    limits?: ProviderCapabilities["limits"];
  };
}

export interface ProvidersFile {
  default: string;
  providers: Record<string, ProviderConfig>;
  routes: Record<Route, string>;
  fallback?: Partial<Record<Route, string[]>>;
}

export function loadProvidersFile(path = "providers.yaml"): ProvidersFile {
  const raw = readFileSync(resolve(process.cwd(), path), "utf8");
  return parse(raw) as ProvidersFile;
}

function resolveCaps(id: string, cfg: ProviderConfig): ProviderCapabilities {
  if (cfg.adapter === "mock") return { ...MOCK_CAPS, id };
  if (!cfg.caps?.media || !cfg.caps?.limits) {
    throw new Error(`provider ${id} 的 caps.media 和 caps.limits 必须显式声明`);
  }
  return {
    id,
    media: cfg.caps.media,
    limits: cfg.caps.limits,
    structuredOutput: cfg.caps.structuredOutput ?? "prompt_only",
    fileUpload: cfg.caps.fileUpload ?? false,
  };
}

export function buildProvider(
  id: string,
  cfg: ProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): AiProvider {
  const caps = resolveCaps(id, cfg);

  if (cfg.adapter === "mock") {
    // mock 默认吐一个能过大多数 schema 的空壳，测试里自己传 responses 覆盖
    return new MockProvider({ responses: ["{}"], caps });
  }

  const baseUrl = cfg.baseUrlEnv ? env[cfg.baseUrlEnv] : cfg.baseUrl;
  if (!baseUrl) {
    throw new Error(
      `provider ${id} 缺少 baseUrl（配置里写 baseUrl 或 baseUrlEnv，后者要在 .env.local 里赋值）`,
    );
  }
  const apiKey = cfg.apiKeyEnv ? (env[cfg.apiKeyEnv] ?? "") : "";
  if (!apiKey) {
    throw new Error(
      `provider ${id} 缺少 API key：请在 .env.local 里设置 ${cfg.apiKeyEnv}`,
    );
  }

  return new OpenAiCompatibleProvider({
    id,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: cfg.model ?? "",
    caps,
    stream: cfg.stream ?? true,
  });
}

/**
 * 取某个场景该用的 provider。
 *
 * AI_PROFILE=mock 时一律返回 MockProvider ：CI 和本地开发不该烧钱，
 * 贡献者 clone 下来没有 key 也要能跑通全部测试。
 */
export function getProvider(
  route: Route,
  file: ProvidersFile = loadProvidersFile(),
  env: NodeJS.ProcessEnv = process.env,
): AiProvider {
  if ((env.AI_PROFILE ?? "mock") === "mock") {
    return new MockProvider({ responses: ["{}"] });
  }
  const id = file.routes[route] ?? file.default;
  const cfg = file.providers[id];
  if (!cfg) throw new Error(`providers.yaml 里没有名为 ${id} 的 provider`);
  return buildProvider(id, cfg, env);
}

/** 某场景的降级链，主 provider 失败时依次尝试 */
export function getFallbacks(
  route: Route,
  file: ProvidersFile = loadProvidersFile(),
  env: NodeJS.ProcessEnv = process.env,
): AiProvider[] {
  if ((env.AI_PROFILE ?? "mock") === "mock") return [];
  return (file.fallback?.[route] ?? [])
    .map((id) => {
      const cfg = file.providers[id];
      if (!cfg) return null;
      try {
        return buildProvider(id, cfg, env);
      } catch {
        // 降级 provider 没配 key 是正常的，不该让主路径挂掉
        return null;
      }
    })
    .filter((p): p is AiProvider => p !== null);
}
