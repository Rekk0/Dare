// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GuessResult from "@/components/GuessResult";

afterEach(cleanup);

describe("GuessResult", () => {
  it.each([["hit", "成功识破！"], ["close", "已经接近了"], ["cold", "不是这个"]] as const)("%s 档显示对应文案", (outcome, copy) => {
    render(<GuessResult outcome={outcome} quotaLeft={2} />);
    expect(screen.getByText(copy)).not.toBeNull();
  });

  it("绝不显示相似度数字", () => {
    const result = { outcome: "close" as const, quotaLeft: 2, similarity: 67 };
    const { container } = render(<GuessResult {...result} />);
    expect(container.textContent).not.toContain("67");
  });

  it("命中时显示名次和赏金份额", () => {
    render(<GuessResult outcome="hit" quotaLeft={1} rank={2} bountyShares={3} />);
    expect(screen.getByText("你是第 2 个")).not.toBeNull();
    expect(screen.getByText("本次赏金份额：3 份")).not.toBeNull();
  });

  it("配额使用 tabular-nums", () => {
    render(<GuessResult outcome="cold" quotaLeft={2} />);
    expect(screen.getByText("2 / 3").className).toContain("tabular-nums");
  });
});
