// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActivityPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const HOUR = 3600_000;

function stubActivity(over: Record<string, unknown> = {}) {
  const now = Date.now();
  const payload = {
    title: "今晚的暗任务",
    code: "9KDY6P",
    status: "recruiting",
    taskDeadline: new Date(now + HOUR).toISOString(),
    startAt: new Date(now + 2 * HOUR).toISOString(),
    endAt: new Date(now + 4 * HOUR).toISOString(),
    voteDeadline: new Date(now + 5 * HOUR).toISOString(),
    eliminated: false,
    ...over,
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
}

/**
 * 一个入口能不能点，看它有没有真的 href。
 * 不能用 getByRole("link")：没有 href 的 a 标签不算 link role，禁用的入口查不到。
 */
async function entry(label: string) {
  const link = await screen.findByText(label);
  return { enabled: link.getAttribute("href") !== null, link };
}

const ENTRIES = ["出题", "我的任务卡", "猜别人的任务", "投票", "看结果"];

describe("活动详情页", () => {
  it("recruiting 只有出题能点", async () => {
    stubActivity({ status: "recruiting" });
    render(<ActivityPage />);

    expect((await entry("出题")).enabled).toBe(true);
    for (const label of ["我的任务卡", "猜别人的任务", "投票", "看结果"]) {
      expect((await entry(label)).enabled).toBe(false);
    }
  });

  it("assigned 能看任务卡但还不能猜", async () => {
    // 分配在交题截止，开场在开始时间，中间这一段就是 assigned
    stubActivity({ status: "assigned" });
    render(<ActivityPage />);

    expect((await entry("我的任务卡")).enabled).toBe(true);
    expect((await entry("猜别人的任务")).enabled).toBe(false);
    expect((await entry("出题")).enabled).toBe(false);
  });

  it("running 能猜，不能投票", async () => {
    stubActivity({ status: "running" });
    render(<ActivityPage />);

    expect((await entry("猜别人的任务")).enabled).toBe(true);
    expect((await entry("我的任务卡")).enabled).toBe(true);
    expect((await entry("投票")).enabled).toBe(false);
  });

  it("voting 能投票，不能猜也不能看结果", async () => {
    stubActivity({ status: "voting" });
    render(<ActivityPage />);

    expect((await entry("投票")).enabled).toBe(true);
    expect((await entry("猜别人的任务")).enabled).toBe(false);
    expect((await entry("看结果")).enabled).toBe(false);
  });

  it("settled 能看结果", async () => {
    stubActivity({ status: "settled" });
    render(<ActivityPage />);

    expect((await entry("看结果")).enabled).toBe(true);
    expect((await entry("投票")).enabled).toBe(true);
  });

  it("不能点的入口禁用但不隐藏，并写清楚为什么", async () => {
    // 藏起来的话用户根本不知道有这么个东西、什么时候能用
    stubActivity({ status: "recruiting" });
    render(<ActivityPage />);

    for (const label of ENTRIES) {
      expect(await screen.findByText(label)).not.toBeNull();
    }
    expect(screen.getByText("等交题截止后分配")).not.toBeNull();
    expect(screen.getByText("开场后才能猜")).not.toBeNull();
  });

  it("出局的人看到原因，所有入口都点不了", async () => {
    stubActivity({ status: "running", eliminated: true });
    render(<ActivityPage />);

    expect(await screen.findByText("你没交题，这局没你了。")).not.toBeNull();
    for (const label of ENTRIES) {
      expect((await entry(label)).enabled).toBe(false);
    }
    // 出局的人也不该看到分享入口
    expect(screen.queryByRole("button", { name: "分享这一局" })).toBeNull();
  });

  it("settled 不显示倒计时，其余状态显示", async () => {
    stubActivity({ status: "settled" });
    const { unmount } = render(<ActivityPage />);
    await screen.findByText("这一局结了");
    expect(screen.queryByText(/离下个节点/)).toBeNull();
    unmount();

    stubActivity({ status: "running" });
    render(<ActivityPage />);
    await waitFor(() => expect(screen.getByText(/离下个节点/)).not.toBeNull());
  });
});
