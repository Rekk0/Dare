import type { ActivityStatus } from "./visibility";

/**
 * 活动状态推进的纯逻辑。
 *
 * 只计算「该不该推进、推到哪」，不碰数据库。
 * 真正写库的部分在 db/queries 里，且每一步都必须幂等：
 *   UPDATE activities SET status=$next WHERE id=$id AND status=$expected RETURNING *
 * 拿到行才继续。worker 重启不会重复分配、不会重复发钱。
 */

export interface ActivitySchedule {
  status: ActivityStatus;
  startAt: Date;
  endAt: Date;
  voteDeadline: Date;
}

export type Transition =
  | { kind: "none"; reason: string }
  | { kind: "advance"; from: ActivityStatus; to: ActivityStatus; action: TransitionAction };

/** 推进时除了改状态还要做的事 */
export type TransitionAction = "assign" | "openVoting" | "settle" | "nothing";

/**
 * 给定当前状态和当前时间，算出下一步。
 *
 * 一次只推进一格。scheduler 每 30s 扫一次，落后多格会在连续几轮里追上，
 * 这样每一格的副作用（分配、结算）都各自走一次独立的幂等事务，
 * 不会挤在一个大事务里。
 */
export function nextTransition(a: ActivitySchedule, now: Date): Transition {
  switch (a.status) {
    case "draft":
      return { kind: "none", reason: "草稿要由创建者手动发布" };

    case "recruiting":
      if (now >= a.startAt) {
        return { kind: "advance", from: "recruiting", to: "locked", action: "nothing" };
      }
      return { kind: "none", reason: "未到开始时间" };

    case "locked":
      // locked 是一个瞬时状态：拿到锁之后立刻分配并进入 running。
      // 单独设这个状态是为了让「锁定」和「分配」是两个独立的幂等步骤，
      // 分配失败时活动停在 locked，可以重试，而不是卡在 recruiting 被反复触发。
      return { kind: "advance", from: "locked", to: "running", action: "assign" };

    case "running":
      if (now >= a.endAt) {
        return { kind: "advance", from: "running", to: "voting", action: "openVoting" };
      }
      return { kind: "none", reason: "活动进行中" };

    case "voting":
      if (now >= a.voteDeadline) {
        return { kind: "advance", from: "voting", to: "settled", action: "settle" };
      }
      return { kind: "none", reason: "投票进行中" };

    case "settled":
      return { kind: "none", reason: "已结算" };
  }
}

export interface ScheduleProblem {
  field: string;
  message: string;
}

/** 建活动时的时间校验。顺序错了整个状态机会卡死 */
export function validateSchedule(
  s: Pick<ActivitySchedule, "startAt" | "endAt" | "voteDeadline">,
  now: Date,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  if (s.startAt <= now) {
    problems.push({ field: "startAt", message: "开始时间必须晚于现在" });
  }
  if (s.endAt <= s.startAt) {
    problems.push({ field: "endAt", message: "结束时间必须晚于开始时间" });
  }
  if (s.voteDeadline <= s.endAt) {
    problems.push({ field: "voteDeadline", message: "投票截止必须晚于结束时间" });
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* 分配前的参与者筛选                                                  */
/* ------------------------------------------------------------------ */

export interface ParticipantForAssign {
  pid: string;
  /** 到 start_at 时是否有一道 accepted 的题 */
  hasAcceptedTask: boolean;
}

export interface AssignRoster {
  /** 参与分配的人，顺序即分配算法里的下标 */
  players: string[];
  /** 没出题的人。仍是参与者，仍可投票和猜，但不领任务、不占奖池 */
  spectators: string[];
}

export const MIN_PLAYERS = 3;

/**
 * 筛出真正参与分配的人。
 *
 * 到 start_at 还没出题的人移出本次分配（标记为旁观者），不阻塞全场 ：
 * 一个人忘了出题不该让整局开不起来。
 *
 * 旁观者仍可投票和猜测，所以**总人数会大于任务数**。
 * 这就是守恒的分母必须是任务数而不是人数的原因（不变量 I2）。
 */
export function buildRoster(participants: ParticipantForAssign[]): AssignRoster {
  const players: string[] = [];
  const spectators: string[] = [];
  for (const p of participants) {
    (p.hasAcceptedTask ? players : spectators).push(p.pid);
  }
  return { players, spectators };
}

export class NotEnoughPlayersError extends Error {
  constructor(readonly count: number) {
    // N=2 时唯一解是互换，双方立刻知道对方的题，机制失效
    super(`参与分配的人不足 ${MIN_PLAYERS} 人（当前 ${count} 人），无法开场`);
    this.name = "NotEnoughPlayersError";
  }
}

export function assertEnoughPlayers(roster: AssignRoster): void {
  if (roster.players.length < MIN_PLAYERS) {
    throw new NotEnoughPlayersError(roster.players.length);
  }
}
