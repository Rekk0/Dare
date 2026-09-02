import type { ZodType } from "zod";
import { AiValidationError, type StructuredOutputTier } from "./types";

/**
 * 跨厂商统一的输出解析与校验。
 *
 * 各家对「保证返回合法 JSON」的支持不一致，这是跨厂商最高频的 bug 来源。
 * 三档降级最终都过这里，业务层拿到的永远是校验过的对象：
 *
 *   json_schema  厂商原生 schema 约束，基本一次过
 *   json_mode    只保证是合法 JSON，字段对不对得自己校验，允许重试 1 次
 *   prompt_only  模型可能在 JSON 前后带解释文字或 ``` 围栏，允许重试 2 次
 */

export function retriesForTier(tier: StructuredOutputTier): number {
  switch (tier) {
    case "json_schema":
      return 0;
    case "json_mode":
      return 1;
    case "prompt_only":
      return 2;
  }
}

/**
 * 从模型输出里抠出 JSON。
 *
 * 按可靠性排序尝试：整体解析 -> ``` 围栏内 -> 第一个平衡的 {} 或 []。
 * 最后一档要真正做括号配对，不能用正则贪婪匹配：字符串字面量里的
 * 花括号会把正则带偏（比如任务文案里出现「{」）。
 */
export function extractJson(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (isParsable(text)) return text;

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1] && isParsable(fence[1].trim())) return fence[1].trim();

  const balanced = firstBalanced(text);
  if (balanced && isParsable(balanced)) return balanced;

  return null;
}

function isParsable(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** 扫描出第一个括号配对完整的 JSON 值，跳过字符串字面量和转义 */
function firstBalanced(text: string): string | null {
  const openIdx = text.search(/[{[]/);
  if (openIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

export interface ParseOutcome<T> {
  ok: boolean;
  data?: T;
  /** 给下一次重试用的纠错提示 */
  problem?: string;
}

/** 解析一次。失败时给出可以回喂给模型的问题描述 */
export function parseOnce<T>(schema: ZodType<T>, raw: string): ParseOutcome<T> {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, problem: "输出里找不到合法的 JSON" };
  }

  const parsed = schema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
      .join("; ");
    return { ok: false, problem: `JSON 结构不符合要求 -> ${issues}` };
  }

  return { ok: true, data: parsed.data };
}

/**
 * 带重试的解析。`again` 由调用方提供，拿到纠错提示后重新问一次模型。
 * 重试次数由厂商的档位决定，不由调用方随便定。
 */
export async function parseAndValidate<T>(
  schema: ZodType<T>,
  first: string,
  tier: StructuredOutputTier,
  again: (problem: string) => Promise<string>,
): Promise<{ data: T; raw: string; retries: number }> {
  const maxRetries = retriesForTier(tier);
  let raw = first;

  for (let attempt = 0; ; attempt++) {
    const outcome = parseOnce(schema, raw);
    if (outcome.ok) {
      return { data: outcome.data as T, raw, retries: attempt };
    }
    if (attempt >= maxRetries) {
      throw new AiValidationError(
        `解析失败(${tier} 档, 重试 ${attempt} 次): ${outcome.problem}`,
        raw,
        attempt + 1,
      );
    }
    raw = await again(outcome.problem as string);
  }
}
