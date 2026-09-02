import { describe, expect, it } from "vitest";
import { apiError, errorStatus } from "@/lib/api";

describe("API 错误映射", () => {
  it.each([["不是执行者", 403], ["非参与者", 403], ["busted 的任务不能投票", 409], ["配额已用尽", 400], ["不能猜自己", 400], ["活动不存在", 404], ["目标没有已分配的任务", 404]])("将 %s 映射为 %i", (message, status) => {
    expect(errorStatus(new Error(message))).toBe(status);
  });
  it("500 不泄露原始错误", async () => {
    const response = apiError(new Error("任务正文不能泄露"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("任务正文");
  });
});
