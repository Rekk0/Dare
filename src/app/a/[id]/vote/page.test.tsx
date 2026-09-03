// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VotePage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("投票页", () => {
  it("报告缺失时显示提示，且不出现昵称", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ assignments: [{
        assignmentId: "a1", assigneePid: "p1", authorPid: null, taskContent: null,
        busted: false, bustedByPid: null, canVote: true, evidence: [], aiReport: null,
      }] }),
    }));
    render(<VotePage />);
    expect(await screen.findByText("AI 还没看完这份")).not.toBeNull();
    expect(screen.queryByText("偷偷的昵称")).toBeNull();
  });
});
