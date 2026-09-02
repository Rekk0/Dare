import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractJson, parseAndValidate, parseOnce, retriesForTier } from "../validate";
import { AiValidationError } from "../types";

const schema = z.object({
  feasibility: z.number().min(0).max(100),
  verdict: z.enum(["accept", "revise", "reject"]),
});

describe("extractJson", () => {
  it("整体就是 JSON", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("带 ``` 围栏", () => {
    const raw = '好的，结果如下：\n```json\n{"a":1}\n```\n还有别的话';
    expect(extractJson(raw)).toBe('{"a":1}');
  });

  it("前后有解释文字，无围栏", () => {
    expect(extractJson('这是结果 {"a":1} 完毕')).toBe('{"a":1}');
  });

  it("字符串字面量里有花括号也能正确配对", () => {
    // 正则贪婪匹配会在这里翻车：任务文案里出现「{」
    const raw = '说明：\n{"note":"任务里写了 { 这个符号","a":1}\n完毕';
    const got = extractJson(raw);
    expect(got).not.toBeNull();
    expect(JSON.parse(got as string)).toEqual({
      note: "任务里写了 { 这个符号",
      a: 1,
    });
  });

  it("嵌套对象取完整的外层", () => {
    const raw = 'x {"a":{"b":[1,2]},"c":3} y';
    expect(JSON.parse(extractJson(raw) as string)).toEqual({ a: { b: [1, 2] }, c: 3 });
  });

  it("没有 JSON 时返回 null", () => {
    expect(extractJson("我无法完成这个请求")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("parseOnce", () => {
  it("合法输入通过", () => {
    const r = parseOnce(schema, '{"feasibility":80,"verdict":"accept"}');
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ feasibility: 80, verdict: "accept" });
  });

  it("字段不合法时给出可回喂的问题描述", () => {
    const r = parseOnce(schema, '{"feasibility":200,"verdict":"maybe"}');
    expect(r.ok).toBe(false);
    expect(r.problem).toContain("feasibility");
    expect(r.problem).toContain("verdict");
  });
});

describe("retriesForTier", () => {
  it("三档各自的重试次数", () => {
    expect(retriesForTier("json_schema")).toBe(0);
    expect(retriesForTier("json_mode")).toBe(1);
    expect(retriesForTier("prompt_only")).toBe(2);
  });
});

describe("parseAndValidate", () => {
  it("一次就对，不重试", async () => {
    const again = vi.fn();
    const r = await parseAndValidate(
      schema,
      '{"feasibility":80,"verdict":"accept"}',
      "prompt_only",
      again,
    );
    expect(r.data.feasibility).toBe(80);
    expect(r.retries).toBe(0);
    expect(again).not.toHaveBeenCalled();
  });

  it("prompt_only 档：第一次脏，重试后拿到合法结果", async () => {
    const again = vi.fn().mockResolvedValue('```json\n{"feasibility":30,"verdict":"revise"}\n```');
    const r = await parseAndValidate(schema, "抱歉，我需要更多信息", "prompt_only", again);
    expect(r.data.verdict).toBe("revise");
    expect(r.retries).toBe(1);
    expect(again).toHaveBeenCalledOnce();
    expect(again.mock.calls[0][0]).toContain("找不到合法的 JSON");
  });

  it("json_schema 档不重试，直接抛错", async () => {
    const again = vi.fn();
    await expect(
      parseAndValidate(schema, "不是 JSON", "json_schema", again),
    ).rejects.toBeInstanceOf(AiValidationError);
    expect(again).not.toHaveBeenCalled();
  });

  it("重试用尽后抛错，带上原始输出便于排查", async () => {
    const again = vi.fn().mockResolvedValue("还是不对");
    await expect(
      parseAndValidate(schema, "一开始就不对", "json_mode", again),
    ).rejects.toMatchObject({ name: "AiValidationError", attempts: 2 });
    expect(again).toHaveBeenCalledOnce();
  });
});
