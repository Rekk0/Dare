// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResultPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stub(over: { settlement?: Record<string, unknown>; assignments?: unknown[] } = {}) {
  const assignments = over.assignments ?? [
    { assignmentId: "a1", assigneePid: "p", authorPid: "q", taskContent: "完成动作", busted: true, bustedByPid: "x", canVote: false, evidence: [], aiReport: null },
    { assignmentId: "a2", assigneePid: "x", authorPid: "p", taskContent: "我自己的题", busted: false, bustedByPid: null, canVote: false, evidence: [], aiReport: null },
  ];
  const settlement = over.settlement ?? { taskShares: "1.000", bountyShares: "0.500", totalShares: "1.500", busted: false };
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ json: async () => ({ assignments }) })
    .mockResolvedValueOnce({ json: async () => settlement })
    .mockResolvedValueOnce({ json: async () => ({ me: "x", participants: [
      { pid: "p", nickname: "执行者阿明" },
      { pid: "q", nickname: "出题人小张" },
      { pid: "x", nickname: "我自己" },
    ] }) })
    .mockResolvedValueOnce({ json: async () => ({ title: "今晚的暗任务" }) }));
}

describe("结算页", () => {
  it("卡片顶部是执行的人，不再是「任务 N」", async () => {
    stub();
    render(<ResultPage />);

    expect(await screen.findByText("执行者阿明")).not.toBeNull();
    expect(screen.queryByText(/^任务 1$/)).toBeNull();
    expect(screen.getByText("出题人：出题人小张")).not.toBeNull();
    expect(screen.getByText("被 我自己 识破")).not.toBeNull();
  });

  it("自己那张卡标出来是自己", async () => {
    stub();
    render(<ResultPage />);
    await screen.findByText("我自己");

    expect(screen.getByText("你")).not.toBeNull();
  });

  it("份额在最上面，不用等任务卡播完才出现", async () => {
    // 打开结果页第一眼要看的就是自己拿了多少，
    // 压在一串 450ms 一条播出来的卡片后面，节奏是反的
    stub();
    render(<ResultPage />);

    // 卡片是 450ms 一条慢慢播出来的，份额必须在那之前就在
    expect(await screen.findByText("1.500")).not.toBeNull();
    expect(screen.queryByText("出题人：出题人小张")).toBeNull();

    // 等卡片播出来之后，份额仍然排在它前面
    await screen.findByText("出题人：出题人小张");
    const body = document.body.textContent ?? "";
    expect(body.indexOf("你的奖励份额")).toBeLessThan(body.indexOf("出题人："));
  });

  it("点分享我的行动报告，弹出可长按保存的图", async () => {
    stub();
    render(<ResultPage />);
    await screen.findByText("1.500");

    fireEvent.click(screen.getByRole("button", { name: "分享我的行动报告" }));

    expect(screen.getByRole("dialog", { name: "分享我的行动报告" })).not.toBeNull();
    expect(screen.getByText("长按图片保存到相册")).not.toBeNull();
  });

  it("数据还没回来时分享按钮点不了", () => {
    // 没有 me 就算不出「我识破了谁」，画出来会是一张空图
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<ResultPage />);

    expect((screen.getByRole("button", { name: "分享我的行动报告" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
