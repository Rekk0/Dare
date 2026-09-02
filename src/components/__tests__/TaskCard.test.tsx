import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TaskCard from "@/components/TaskCard";
import type { MyAssignmentDto } from "@/core/visibility";

const taskContent = "让坐在你右边的人主动唱一首粤语歌";
const bustedByPid = "guesser-secret-pid";

function makeAssignment(overrides: Partial<MyAssignmentDto> = {}): MyAssignmentDto {
  return { assignmentId: "assignment-1", taskContent, busted: false, bustedByPid, ...overrides };
}

function renderCard(assignment = makeAssignment()) {
  return render(<TaskCard assignment={assignment} endAt={new Date(Date.now() + 60_000)} />);
}

afterEach(cleanup);

describe("TaskCard", () => {
  it("任务未分配时显示提示且不渲染 Redacted", () => {
    const { container } = renderCard(makeAssignment({ taskContent: null }));
    expect(screen.getByText("任务尚未分配")).not.toBeNull();
    expect(container.querySelector(".rdt")).toBeNull();
  });

  it("正常态渲染 Redacted，正文初始保持不可见", () => {
    const { container } = renderCard();
    const unit = container.querySelector(".rdt-unit");
    expect(unit).not.toBeNull();
    expect(unit?.getAttribute("style")).toBeNull();
    expect(screen.getByRole("button", { name: "上传证据" })).not.toBeNull();
  });

  it("被识破时显示标签且上传按钮改为面子入口", () => {
    renderCard(makeAssignment({ busted: true }));
    expect(screen.getByText("已暴露")).not.toBeNull();
    expect(screen.getByRole("button", { name: "为面子继续上传" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "上传证据" })).toBeNull();
  });

  it("绝不向 DOM 暴露识破者身份", () => {
    const { container } = renderCard(makeAssignment({ busted: true }));
    expect(container.innerHTML).not.toContain(bustedByPid);
  });
});
