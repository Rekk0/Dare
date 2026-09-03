import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, validatePolicy } from "../review-policy";

describe("任务预审标准", () => {
  it("默认值正确", () => {
    expect(DEFAULT_POLICY).toEqual({
      minFeasibility: 30,
      minStealth: 20,
      minFun: 20,
      minVerifiability: 20,
      edginess: 2,
    });
  });

  it("没传的字段落回默认值", () => {
    // 显式传 undefined 也要落回默认。展开运算符会用 undefined 覆盖掉默认值，
    // 而 API 层从 body 里取字段时拿到的正是 undefined
    expect(validatePolicy({})).toEqual(DEFAULT_POLICY);
    expect(validatePolicy({ minStealth: undefined })).toEqual(DEFAULT_POLICY);
    expect(validatePolicy({ minFeasibility: 60 })).toEqual({ ...DEFAULT_POLICY, minFeasibility: 60 });
  });

  it("拒绝越界阈值和非法尺度", () => {
    expect(() => validatePolicy({ minFeasibility: -1 })).toThrow();
    expect(() => validatePolicy({ minStealth: 101 })).toThrow();
    expect(() => validatePolicy({ minFun: 101 })).toThrow();
    expect(() => validatePolicy({ minVerifiability: 101 })).toThrow();
    expect(() => validatePolicy({ minFeasibility: 40.5 })).toThrow();
    expect(() => validatePolicy({ edginess: 0 as 1 })).toThrow();
    expect(() => validatePolicy({ edginess: 4 as 1 })).toThrow();
  });

  it("边界值 0 和 100 合法", () => {
    expect(validatePolicy({ minStealth: 0 }).minStealth).toBe(0);
    expect(validatePolicy({ minStealth: 100 }).minStealth).toBe(100);
  });
});
