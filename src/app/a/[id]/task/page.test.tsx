// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(cleanup);

describe("出题页", () => {
  it("revise 显示修改建议且可以坚持提交", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verdict: "revise", canForceSubmit: true, scores: { feasibility: 70, stealth: 60, fun: 80, verifiability: 50, safety: "ok", suggestions: ["把范围再收一点，别让人一眼就锁定答案。"] } }) }));
    render(<TaskPage />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "一道题" } }); fireEvent.click(screen.getByRole("button", { name: "提交并预审" }));
    expect(await screen.findByText("把范围再收一点，别让人一眼就锁定答案。")).not.toBeNull(); expect((screen.getByRole("button", { name: "就按这题提交" }) as HTMLButtonElement).disabled).toBe(false); vi.unstubAllGlobals();
  });
  it("reject 时提交按钮禁用", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verdict: "reject", canForceSubmit: false, scores: { feasibility: 0, stealth: 0, fun: 0, verifiability: 0, safety: "block", suggestions: [] } }) }));
    render(<TaskPage />); fireEvent.change(screen.getByRole("textbox"), { target: { value: "危险题" } }); fireEvent.click(screen.getByRole("button", { name: "提交并预审" }));
    expect(await screen.findByText("这题不行")).not.toBeNull(); expect((screen.getByRole("button", { name: "提交并预审" }) as HTMLButtonElement).disabled).toBe(true); vi.unstubAllGlobals();
  });
});
