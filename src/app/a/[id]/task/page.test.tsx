// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const reviseResponse = {
  verdict: "revise",
  canForceSubmit: true,
  token: "1700000000000.eyJhIjoxfQ.deadbeef",
  scores: { feasibility: 70, stealth: 60, fun: 80, verifiability: 50, safety: "ok", reasons: [], suggestions: ["把范围再收一点，别让人一眼就锁定答案。"] },
};

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 写一道题并跑完预审 */
async function preview(text: string) {
  render(<TaskPage />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "提交并预审" }));
}

describe("出题页", () => {
  it("revise 显示修改建议", async () => {
    stubFetch(reviseResponse);
    await preview("一道题");

    expect(await screen.findByText("把范围再收一点，别让人一眼就锁定答案。")).not.toBeNull();
  });

  it("预审完换成重新预审和确认提交两个按钮", async () => {
    // 只留一个「提交并预审」的话，用户不知道自己下一步该干什么
    stubFetch(reviseResponse);
    await preview("一道题");

    expect(await screen.findByRole("button", { name: "确认提交" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "重新提交预审" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "提交并预审" })).toBeNull();
  });

  it("确认提交把正文和预审凭据一起带回去", async () => {
    // 预审那一步什么都没入库，确认这一步得靠凭据验签，所以正文必须带上
    const fetchMock = stubFetch(reviseResponse);
    await preview("一道题");
    fireEvent.click(await screen.findByRole("button", { name: "确认提交" }));

    const lastBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(lastBody.confirm).toBe(true);
    expect(lastBody.content).toBe("一道题");
    expect(lastBody.token).toBe(reviseResponse.token);
  });

  it("每个界面都有回这一局的入口", async () => {
    // 五个子页面原来一个返回入口都没有，进去只能靠浏览器后退
    render(<TaskPage />);
    expect(screen.getByRole("link", { name: "< 返回活动页" }).getAttribute("href")).toBe("/a/activity-1");
  });

  it("改了题就不能直接确认，评分也一起收起来", async () => {
    // 库里存的还是改之前那道题，这时候确认下去交的是旧的
    stubFetch(reviseResponse);
    await preview("一道题");
    await screen.findByRole("button", { name: "确认提交" });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改过的题" } });

    expect((screen.getByRole("button", { name: "确认提交" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("把范围再收一点，别让人一眼就锁定答案。")).toBeNull();
    expect(screen.getByText("题改了，再预审一次才能提交。")).not.toBeNull();
  });

  it("reject 时只有一个按钮且禁用", async () => {
    stubFetch({ verdict: "reject", canForceSubmit: false, scores: { feasibility: 0, stealth: 0, fun: 0, verifiability: 0, safety: "block", reasons: [], suggestions: [] } });
    await preview("危险题");

    expect(await screen.findByText("这任务不行")).not.toBeNull();
    expect((screen.getByRole("button", { name: "提交并预审" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "确认提交" })).toBeNull();
  });

  it("safety=warn 时把理由显示出来", async () => {
    // warn 不拦，但攒局的人得看见提醒了什么
    stubFetch({ verdict: "accept", canForceSubmit: false, scores: { feasibility: 80, stealth: 70, fun: 80, verifiability: 70, safety: "warn", reasons: ["这题会把没参加游戏的人卷进来。"], suggestions: [] } });
    await preview("拉个路人");

    expect(await screen.findByText("这题会把没参加游戏的人卷进来。")).not.toBeNull();
  });
});
