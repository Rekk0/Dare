// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BustedScreen, { type BustedScreenProps } from "@/components/BustedScreen";

const secretPid = "guesser-secret-pid";
type HasGuesserIdentity = "bustedByPid" extends keyof BustedScreenProps ? true : false;
const hasGuesserIdentity: HasGuesserIdentity = false;

afterEach(cleanup);

describe("BustedScreen", () => {
  it("渲染主副标题和全部说明文案", () => {
    render(<BustedScreen />);
    expect(screen.getByText("暴露了")).not.toBeNull();
    expect(screen.getByText("BUSTED")).not.toBeNull();
    expect(screen.getByText("你的任务已经被识破。")).not.toBeNull();
    expect(screen.getByText("任务失败，奖励丢失。")).not.toBeNull();
    expect(screen.getByText("识破者在结算时揭晓。")).not.toBeNull();
  });

  it("两个按钮触发对应回调", () => {
    const onContinue = vi.fn();
    const onDismiss = vi.fn();
    render(<BustedScreen onContinue={onContinue} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "为面子继续" }));
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("类型和 DOM 都不包含识破者身份", () => {
    expect(hasGuesserIdentity).toBe(false);
    const { container } = render(<BustedScreen />);
    expect(container.innerHTML).not.toContain(secretPid);
  });

  it("减弱动效下仍显示全部文案", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<BustedScreen />);
    expect(screen.getByText("暴露了")).not.toBeNull();
    expect(screen.getByText("识破者在结算时揭晓。")).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
