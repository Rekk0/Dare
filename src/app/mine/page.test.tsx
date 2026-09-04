// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "../page";
import MyActivitiesPage from "./page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const HOUR = 3600_000;

function row(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "act-1",
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
}

function stub(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activities: rows }) }));
}

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("落地页", () => {
  it("三条路都在，指向对的地方", () => {
    render(<Home />);
    expect(href("新建活动")).toBe("/new");
    expect(href("输入邀请码")).toBe("/join");
    expect(href("我的活动")).toBe("/mine");
  });

  it("标识用的是路径不是文字，换设备不会掉字", () => {
    // 得意黑子集里没有 A 和 R，用字体渲染会静默掉回系统字
    const { container } = render(<Home />);
    const svg = container.querySelector('svg[aria-label="DARE"]');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("text")).toBeNull();
  });
});

describe("我参加的局", () => {
  it("列出加入过的局，还没开场的也算", async () => {
    stub([row({ status: "recruiting" })]);
    render(<MyActivitiesPage />);

    expect(await screen.findByText("今晚的暗任务")).not.toBeNull();
    expect(screen.getByText("还在交题")).not.toBeNull();
    expect(screen.getByRole("link", { name: /今晚的暗任务/ }).getAttribute("href")).toBe("/a/act-1");
  });

  it("已结束的沉到后面单独一组", async () => {
    stub([
      row({ id: "a1", title: "结了的", status: "settled" }),
      row({ id: "a2", title: "在跑的", status: "running" }),
    ]);
    render(<MyActivitiesPage />);

    await screen.findByText("在跑的");
    expect(screen.getByText("已经结束")).not.toBeNull();
    // 在跑的排在分组标题前面
    const body = document.body.textContent ?? "";
    expect(body.indexOf("在跑的")).toBeLessThan(body.indexOf("已经结束"));
  });

  it("出局的局也列出来，但标明原因", async () => {
    // 不列的话用户会以为自己进错了地方，列了不标又不知道为什么点进去是空的
    stub([row({ eliminated: true })]);
    render(<MyActivitiesPage />);

    expect(await screen.findByText("你没交题，这局没你了")).not.toBeNull();
  });

  it("一局都没有时给两条出路", async () => {
    stub([]);
    render(<MyActivitiesPage />);

    expect(await screen.findByText("你还没加入任何活动。")).not.toBeNull();
    expect(href("攒一局")).toBe("/new");
    expect(href("输入邀请码")).toBe("/join");
  });

  it("接口挂了不白屏", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("网络挂了")));
    render(<MyActivitiesPage />);

    expect(await screen.findByText("你还没加入任何活动。")).not.toBeNull();
  });
});
