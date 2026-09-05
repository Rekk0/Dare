// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GuessResult from "@/components/GuessResult";

afterEach(cleanup);

describe("GuessResult", () => {
  it.each([["hit", "成功识破！"], ["close", "已经接近了"], ["cold", "不是这个"]] as const)("%s 档显示对应文案", (outcome, copy) => {
    render(<GuessResult outcome={outcome} quotaLeft={2} quotaTotal={3} />);
    expect(screen.getByText(copy)).not.toBeNull();
  });

  it("绝不显示相似度数字", () => {
    const result = { outcome: "close" as const, quotaLeft: 2, quotaTotal: 3, similarity: 67 };
    const { container } = render(<GuessResult {...result} />);
    expect(container.textContent).not.toContain("67");
  });

  it("命中时显示名次和赏金份额", () => {
    render(<GuessResult outcome="hit" quotaLeft={1} quotaTotal={3} rank={2} bountyShares={3} />);
    expect(screen.getByText("你是第 2 个")).not.toBeNull();
    expect(screen.getByText("本次赏金份额：3 份")).not.toBeNull();
  });

  it("配额使用 tabular-nums", () => {
    render(<GuessResult outcome="cold" quotaLeft={2} quotaTotal={3} />);
    expect(screen.getByText("2 / 3").className).toContain("tabular-nums");
  });

  // 分母原来写死成 3。人多的局配额是 floor(人数/3)，
  // 15 人时每人 5 次，界面会显示成「剩 5 / 3」
  it("分母跟着这一局的配额走，不写死 3", () => {
    render(<GuessResult outcome="cold" quotaLeft={5} quotaTotal={7} />);
    expect(screen.getByText("5 / 7")).not.toBeNull();
  });

  it("配额用尽时不显示再猜一次", () => {
    render(<GuessResult outcome="cold" quotaLeft={0} quotaTotal={7} onAgain={() => {}} />);
    expect(screen.queryByText("再猜一个")).toBeNull();
  });
});
