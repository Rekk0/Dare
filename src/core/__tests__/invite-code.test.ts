import { describe, expect, it } from "vitest";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, inviteCode } from "../invite-code";

describe("邀请码", () => {
  it("不含形近字符和标点", () => {
    // 6 位码要靠嘴说、靠手打，I/L/O/0/1 会被听错看错，
    // - 和 _ 在电话里根本讲不清楚
    for (const ch of "ILO01-_") {
      expect(INVITE_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("全大写，长度固定", () => {
    for (let i = 0; i < 200; i++) {
      const code = inviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).toBe(code.toUpperCase());
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
    }
  });

  it("字母表里没有重复字符", () => {
    // 有重复的话某些字符出现概率翻倍，熵会比看上去的低
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(INVITE_CODE_ALPHABET.length);
  });

  it("两百次生成基本不重样", () => {
    const seen = new Set(Array.from({ length: 200 }, () => inviteCode()));
    expect(seen.size).toBe(200);
  });
});
