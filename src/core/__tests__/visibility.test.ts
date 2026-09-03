import { describe, expect, it } from "vitest";
import {
  canSeeAiReport,
  canSeeAssignmentMapping,
  canSeeBusted,
  canSeeEvidence,
  canSeeGuess,
  canSeeGuesserIdentity,
  canSeeTaskContent,
  canVote,
  projectMyAssignment,
  projectReveal,
  toGuessOutcome,
  type ActivityStatus,
  type AssignmentFacts,
  type RevealAssignmentRow,
} from "../visibility";

/**
 * 可见性矩阵的每一格都要有测试。这是保密的唯一防线，
 * 覆盖不全等于没写：漏掉一格就是一条泄露路径。
 */

const STATUSES: ActivityStatus[] = [
  "draft",
  "recruiting",
  "locked",
  "running",
  "voting",
  "settled",
];

// a1: 由 bob 出题，alice 执行。carol 是无关第三方
const A: AssignmentFacts = {
  assignmentId: "a1",
  assigneePid: "alice",
  authorPid: "bob",
  busted: false,
};

const v = (pid: string, status: ActivityStatus) => ({ pid, status });

/** 断言某条规则在各阶段对某个人的结果 */
function matrix(
  fn: (viewer: { pid: string; status: ActivityStatus }, a: AssignmentFacts) => boolean,
  pid: string,
  facts: AssignmentFacts = A,
) {
  return STATUSES.map((s) => [s, fn(v(pid, s), facts)] as const);
}

describe("任务正文", () => {
  it("出题者始终可见", () => {
    expect(matrix(canSeeTaskContent, "bob")).toEqual(
      STATUSES.map((s) => [s, true]),
    );
  });

  it("执行者 locked 后可见", () => {
    expect(matrix(canSeeTaskContent, "alice")).toEqual([
      ["draft", false],
      ["recruiting", false],
      ["locked", true],
      ["running", true],
      ["voting", true],
      ["settled", true],
    ]);
  });

  it("其他人 settled 后才可见", () => {
    expect(matrix(canSeeTaskContent, "carol")).toEqual([
      ["draft", false],
      ["recruiting", false],
      ["locked", false],
      ["running", false],
      ["voting", false],
      ["settled", true],
    ]);
  });
});

describe("谁执行谁的题（映射关系）", () => {
  it("出题者也要到 settled 才知道自己的题给了谁", () => {
    // 不堵这条，他盯住一个人看就行，整个机制直接崩
    expect(matrix(canSeeAssignmentMapping, "bob")).toEqual([
      ["draft", false],
      ["recruiting", false],
      ["locked", false],
      ["running", false],
      ["voting", false],
      ["settled", true],
    ]);
  });

  it("执行者和第三方同样到 settled", () => {
    for (const pid of ["alice", "carol"]) {
      expect(matrix(canSeeAssignmentMapping, pid)).toEqual([
        ["draft", false],
        ["recruiting", false],
        ["locked", false],
        ["running", false],
        ["voting", false],
        ["settled", true],
      ]);
    }
  });
});

describe("证据", () => {
  it("执行者始终能看自己的", () => {
    expect(matrix(canSeeEvidence, "alice")).toEqual(STATUSES.map((s) => [s, true]));
  });

  it("其他人 voting 后可见", () => {
    for (const pid of ["bob", "carol"]) {
      expect(matrix(canSeeEvidence, pid)).toEqual([
        ["draft", false],
        ["recruiting", false],
        ["locked", false],
        ["running", false],
        ["voting", true],
        ["settled", true],
      ]);
    }
  });
});

describe("AI 报告", () => {
  it("所有人都是 voting 后可见，含执行者本人", () => {
    for (const pid of ["alice", "bob", "carol"]) {
      expect(matrix(canSeeAiReport, pid)).toEqual([
        ["draft", false],
        ["recruiting", false],
        ["locked", false],
        ["running", false],
        ["voting", true],
        ["settled", true],
      ]);
    }
  });
});

describe("被识破状态", () => {
  it("执行者本人立即知道", () => {
    // v0.4：一票否决后他已归零，没有可保护的利益，继续瞒只是让人白干两小时
    expect(matrix(canSeeBusted, "alice")).toEqual(STATUSES.map((s) => [s, true]));
  });

  it("其他人 settled 后才知道", () => {
    // 中途让别人知道某人已出局会影响他们的猜测策略
    for (const pid of ["bob", "carol"]) {
      expect(matrix(canSeeBusted, pid)).toEqual([
        ["draft", false],
        ["recruiting", false],
        ["locked", false],
        ["running", false],
        ["voting", false],
        ["settled", true],
      ]);
    }
  });
});

describe("识破者身份", () => {
  it("任何人在 settled 前都拿不到，包括被识破者本人", () => {
    // 当场告诉他就变复仇局，猜中者会被针对
    for (const pid of ["alice", "bob", "carol"]) {
      expect(matrix(canSeeGuesserIdentity, pid)).toEqual([
        ["draft", false],
        ["recruiting", false],
        ["locked", false],
        ["running", false],
        ["voting", false],
        ["settled", true],
      ]);
    }
  });
});

describe("猜测记录", () => {
  it("猜测者自己始终可见", () => {
    for (const s of STATUSES) {
      expect(canSeeGuess(v("carol", s), "carol")).toBe(true);
    }
  });

  it("其他人 settled 后可见", () => {
    expect(STATUSES.map((s) => [s, canSeeGuess(v("alice", s), "carol")])).toEqual([
      ["draft", false],
      ["recruiting", false],
      ["locked", false],
      ["running", false],
      ["voting", false],
      ["settled", true],
    ]);
  });
});

describe("投票资格", () => {
  it("只在 voting 阶段", () => {
    expect(matrix(canVote, "carol")).toEqual([
      ["draft", false],
      ["recruiting", false],
      ["locked", false],
      ["running", false],
      ["voting", true],
      ["settled", false],
    ]);
  });

  it("不能投自己", () => {
    expect(canVote(v("alice", "voting"), A)).toBe(false);
  });

  it("被识破的任务不进公投", () => {
    // 钱已经定了，投了不影响结果，开着只会让人困惑
    const busted = { ...A, busted: true };
    expect(canVote(v("carol", "voting"), busted)).toBe(false);
  });
});

describe("DTO 裁剪", () => {
  const row: RevealAssignmentRow = {
    ...A,
    busted: true,
    taskContent: "让坐你右边的人主动唱一首粤语歌",
    bustedByPid: "carol",
    evidence: [{ id: "e1", kind: "image", url: "/evidence.jpg", mime: "image/jpeg" }],
    aiReport: { summary: "证据里有人在唱歌" },
  };

  it("running 阶段：执行者看得到内容和被识破，但看不到是谁", () => {
    const dto = projectMyAssignment(v("alice", "running"), row);
    expect(dto.taskContent).toBe(row.taskContent);
    expect(dto.busted).toBe(true);
    expect(dto.bustedByPid).toBeNull();
  });

  it("settled 后才给出识破者身份", () => {
    const dto = projectMyAssignment(v("alice", "settled"), row);
    expect(dto.bustedByPid).toBe("carol");
  });

  it("locked 前执行者看不到任务正文，返回 null 而不是空串", () => {
    const dto = projectMyAssignment(v("alice", "recruiting"), row);
    expect(dto.taskContent).toBeNull();
  });

  it("voting 阶段第三方看不到任务正文、作者、识破者", () => {
    const dto = projectReveal(v("carol", "voting"), row);
    expect(dto.taskContent).toBeNull();
    expect(dto.authorPid).toBeNull();
    expect(dto.bustedByPid).toBeNull();
    expect(dto.busted).toBe(false); // 中途不暴露别人已出局
    expect(dto.canVote).toBe(false); // busted 的不进公投
    expect(dto.evidence).toEqual(row.evidence);
    expect(dto.aiReport).toEqual(row.aiReport);
  });

  it("running 阶段非执行者拿到空证据和空报告", () => {
    const dto = projectReveal(v("carol", "running"), row);
    expect(dto.evidence).toEqual([]);
    expect(dto.aiReport).toBeNull();
  });

  it("running 阶段执行者能看到自己的证据，但 AI 报告仍保密", () => {
    const dto = projectReveal(v("alice", "running"), row);
    expect(dto.evidence).toEqual(row.evidence);
    expect(dto.aiReport).toBeNull();
  });

  it("settled 后第三方拿到完整信息", () => {
    const dto = projectReveal(v("carol", "settled"), row);
    expect(dto.taskContent).toBe(row.taskContent);
    expect(dto.authorPid).toBe("bob");
    expect(dto.busted).toBe(true);
    expect(dto.bustedByPid).toBe("carol");
  });

  it("DTO 里没有 rationale 和 similarity 字段", () => {
    // 类型层面已经杜绝，这里再钉一道运行时断言防止将来手滑加回来
    const dto = projectReveal(v("carol", "settled"), row);
    expect(Object.keys(dto)).not.toContain("rationale");
    expect(Object.keys(dto)).not.toContain("similarity");
    const mine = projectMyAssignment(v("alice", "settled"), row);
    expect(Object.keys(mine)).not.toContain("rationale");
  });
});

describe("猜测反馈只给三档，不给数字", () => {
  it("阈值分档", () => {
    // 给精确分数等于给了一个可以二分逼近的预言机
    expect(toGuessOutcome(90)).toBe("hit");
    expect(toGuessOutcome(75)).toBe("hit");
    expect(toGuessOutcome(74)).toBe("close");
    expect(toGuessOutcome(60)).toBe("close");
    expect(toGuessOutcome(59)).toBe("cold");
    expect(toGuessOutcome(0)).toBe("cold");
  });

  it("阈值可按活动配置", () => {
    expect(toGuessOutcome(70, 65)).toBe("hit");
    expect(toGuessOutcome(70, 80)).toBe("close");
  });
});
