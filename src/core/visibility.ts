/**
 * 可见性矩阵 —— 保密的唯一实现。权威定义见 project-design.md §3.1。
 *
 * 这个文件和 settle.ts 是全项目仅有的两处「错了会很惨」的逻辑：
 * 一个算错发错钱，一个写错泄露任务。所以两者都是无 IO 的纯函数，
 * 才能被穷举验证。**任何一条可见性判断散进 route handler，就等于放弃了验证。**
 *
 * 两条最容易写错、后果最严重的规则：
 *
 *   1. 出题者不能知道自己的题给了谁（直到 settled）。
 *      不堵这条，他只要盯住一个人看就行，整个机制直接崩。
 *
 *   2. 被识破者立即知道「我被识破了」，但到 settled 才知道「是谁识破的」。
 *      前者：一票否决后他已经归零，没有可保护的利益，继续瞒只是让人白干。
 *      后者：当场告诉他就变复仇局，猜中者会被针对。
 */

export type ActivityStatus =
  | "draft"
  | "recruiting"
  | "locked"
  | "running"
  | "voting"
  | "settled";

const ORDER: Record<ActivityStatus, number> = {
  draft: 0,
  recruiting: 1,
  locked: 2,
  running: 3,
  voting: 4,
  settled: 5,
};

export function atLeast(status: ActivityStatus, min: ActivityStatus): boolean {
  return ORDER[status] >= ORDER[min];
}

export interface Viewer {
  status: ActivityStatus;
  /** 观看者的 participant id */
  pid: string;
}

/** 判断可见性需要的最小事实。不要把整行实体传进来 */
export interface AssignmentFacts {
  assignmentId: string;
  /** 执行者 */
  assigneePid: string;
  /** 出题者 */
  authorPid: string;
  busted: boolean;
}

/* ------------------------------------------------------------------ */
/* 单条规则                                                            */
/* ------------------------------------------------------------------ */

/**
 * 任务正文。
 * 作者始终可见（是他自己写的）；执行者 locked 后可见；其他人 settled 后可见。
 */
export function canSeeTaskContent(v: Viewer, a: AssignmentFacts): boolean {
  if (v.pid === a.authorPid) return true;
  if (v.pid === a.assigneePid) return atLeast(v.status, "locked");
  return atLeast(v.status, "settled");
}

/**
 * 「谁执行谁的题」这个映射关系。
 *
 * 对所有人都是 settled 后才可见 —— **包括出题者本人**。
 * 执行者知道自己领了一道题，但不知道是谁出的，这不算知道映射关系。
 */
export function canSeeAssignmentMapping(v: Viewer, a: AssignmentFacts): boolean {
  void a;
  return atLeast(v.status, "settled");
}

/** 证据文件。自己的始终可见，别人的 voting 后可见 */
export function canSeeEvidence(v: Viewer, a: AssignmentFacts): boolean {
  if (v.pid === a.assigneePid) return true;
  return atLeast(v.status, "voting");
}

/** AI 报告。voting 后全员可见（含执行者本人） */
export function canSeeAiReport(v: Viewer, a: AssignmentFacts): boolean {
  void a;
  return atLeast(v.status, "voting");
}

/**
 * 「这个任务被识破了」这条状态。
 *
 * 执行者本人：立即可见，不等 settled。
 * 其他所有人：settled 后。中途让别人知道某人已出局会影响他们的猜测策略。
 */
export function canSeeBusted(v: Viewer, a: AssignmentFacts): boolean {
  if (v.pid === a.assigneePid) return true;
  return atLeast(v.status, "settled");
}

/**
 * 「是谁识破的」这个身份。
 *
 * 任何人在 settled 前都拿不到，包括被识破者本人。
 * 猜中者自己知道他猜中了谁，那是他自己的猜测记录，走 canSeeOwnGuess。
 */
export function canSeeGuesserIdentity(v: Viewer, a: AssignmentFacts): boolean {
  void a;
  return atLeast(v.status, "settled");
}

/** 一条猜测记录对谁可见：猜测者自己始终可见，其他人 settled 后 */
export function canSeeGuess(v: Viewer, guesserPid: string): boolean {
  if (v.pid === guesserPid) return true;
  return atLeast(v.status, "settled");
}

/** 能不能投票：只在 voting 阶段、不能投自己、被识破的不进公投 */
export function canVote(v: Viewer, a: AssignmentFacts): boolean {
  if (v.status !== "voting") return false;
  if (v.pid === a.assigneePid) return false;
  return !a.busted;
}

/* ------------------------------------------------------------------ */
/* 对外 DTO                                                            */
/* ------------------------------------------------------------------ */

/**
 * 猜测的对外结果。
 *
 * **这个类型里永远不会有 rationale 和 targetPid 之外的身份信息。**
 * AI 的判定理由里必然包含任务原文，下发等于白送答案。
 * 用类型在编译期杜绝，不靠运行时记得过滤。
 *
 * similarity 也不下发：给了精确分数就等于给了一个可以二分逼近的预言机。
 * 只给三档粗粒度反馈。
 */
export interface GuessResultDto {
  outcome: "hit" | "close" | "cold";
  quotaLeft: number;
  /** 命中时才有。他需要知道抢到第几名才能判断还值不值得继续猜 */
  rank?: number;
  bountyShares?: number;
}

export const GUESS_HIT_THRESHOLD = 75;
export const GUESS_CLOSE_THRESHOLD = 60;

export function toGuessOutcome(similarity: number, hitThreshold = GUESS_HIT_THRESHOLD) {
  if (similarity >= hitThreshold) return "hit" as const;
  if (similarity >= GUESS_CLOSE_THRESHOLD) return "close" as const;
  return "cold" as const;
}

/** 执行者看自己的任务时拿到的东西 */
export interface MyAssignmentDto {
  assignmentId: string;
  /** 不满足可见条件时为 null，而不是空串 */
  taskContent: string | null;
  busted: boolean;
  /** 到 settled 才有值。中途给了就变复仇局 */
  bustedByPid: string | null;
}

export interface AssignmentRow extends AssignmentFacts {
  taskContent: string;
  bustedByPid: string | null;
}

/** 按可见性裁剪出执行者视角的 DTO。裁剪在这里做，不在 route handler 里做 */
export function projectMyAssignment(v: Viewer, row: AssignmentRow): MyAssignmentDto {
  return {
    assignmentId: row.assignmentId,
    taskContent: canSeeTaskContent(v, row) ? row.taskContent : null,
    busted: canSeeBusted(v, row) ? row.busted : false,
    bustedByPid: canSeeGuesserIdentity(v, row) ? row.bustedByPid : null,
  };
}

/** 揭晓阶段每条 assignment 的对外形状 */
export interface RevealAssignmentDto {
  assignmentId: string;
  assigneePid: string;
  /** 不可见时为 null */
  authorPid: string | null;
  taskContent: string | null;
  busted: boolean;
  bustedByPid: string | null;
  canVote: boolean;
}

export function projectReveal(v: Viewer, row: AssignmentRow): RevealAssignmentDto {
  return {
    assignmentId: row.assignmentId,
    assigneePid: row.assigneePid,
    authorPid: canSeeAssignmentMapping(v, row) ? row.authorPid : null,
    taskContent: canSeeTaskContent(v, row) ? row.taskContent : null,
    busted: canSeeBusted(v, row) ? row.busted : false,
    bustedByPid: canSeeGuesserIdentity(v, row) ? row.bustedByPid : null,
    canVote: canVote(v, row),
  };
}
