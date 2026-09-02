// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResultPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(cleanup);

describe("结算页", () => {
  it("被识破的人有已暴露标签，份额数字不是红色", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ json: async () => ({ assignments: [{ assignmentId: "a", assigneePid: "p", authorPid: "q", taskContent: "完成动作", busted: true, bustedByPid: "x", canVote: false }] }) }).mockResolvedValueOnce({ json: async () => ({ taskShares: 0, bountyShares: 0, totalShares: 0, busted: true }) }));
    render(<ResultPage />); expect(await screen.findByText("已暴露")).not.toBeNull(); const share = await screen.findByText("0", { selector: "p" }); expect(share.className).not.toContain("text-alarm"); vi.unstubAllGlobals();
  });
});
