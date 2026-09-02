import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assign } from "@/core/assign";
import {
  assertEnoughPlayers,
  buildRoster,
  nextTransition,
  type ActivitySchedule,
  type Transition,
} from "@/core/lifecycle";
import type { ActivityStatus } from "@/core/visibility";
import type { Db } from "../client";
import { activities, assignments, participants, tasks } from "../schema";

/**
 * 活动生命周期的写库操作。
 *
 * **每一步都必须幂等。** scheduler 每 30s 扫一次，进程可能重启、可能有多个实例，
 * 同一个活动的同一次推进随时可能被触发两次。
 * 所有推进都走 `UPDATE ... WHERE status = $expected`，拿到行才继续 ：
 * 拿不到行说明别人已经推过了，直接返回，不报错。
 *
 * 重复分配和重复发钱是这个项目最不能出的两种错。
 */

export interface AdvanceResult {
  advanced: boolean;
  from?: ActivityStatus;
  to?: ActivityStatus;
  reason?: string;
}

/**
 * 条件更新。这是全部幂等性的来源。
 * 返回 true 表示本次调用真的推进了；false 表示别人已经推过了。
 */
async function casStatus(
  db: Db,
  activityId: string,
  expected: ActivityStatus,
  next: ActivityStatus,
): Promise<boolean> {
  const rows = await db
    .update(activities)
    .set({ status: next })
    .where(and(eq(activities.id, activityId), eq(activities.status, expected)))
    .returning({ id: activities.id });
  return rows.length > 0;
}

async function loadSchedule(db: Db, activityId: string): Promise<ActivitySchedule | null> {
  const rows = await db
    .select({
      status: activities.status,
      startAt: activities.startAt,
      endAt: activities.endAt,
      voteDeadline: activities.voteDeadline,
    })
    .from(activities)
    .where(eq(activities.id, activityId));
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status as ActivityStatus,
    startAt: r.startAt,
    endAt: r.endAt,
    voteDeadline: r.voteDeadline,
  };
}

/**
 * 推进一个活动一格。
 *
 * 一次只推一格是刻意的：每一格的副作用（分配、结算）各走一次独立的幂等事务，
 * 不挤在一个大事务里。落后多格靠 scheduler 连续几轮追上。
 */
export async function advanceActivity(
  db: Db,
  activityId: string,
  now: Date = new Date(),
): Promise<AdvanceResult> {
  const sched = await loadSchedule(db, activityId);
  if (!sched) return { advanced: false, reason: "活动不存在" };

  const t: Transition = nextTransition(sched, now);
  if (t.kind === "none") return { advanced: false, reason: t.reason };

  if (t.action === "assign") {
    // 分配自带 CAS，见 performAssignment
    const ok = await performAssignment(db, activityId);
    return ok
      ? { advanced: true, from: t.from, to: t.to }
      : { advanced: false, reason: "已被其他实例分配" };
  }

  const ok = await casStatus(db, activityId, t.from, t.to);
  return ok
    ? { advanced: true, from: t.from, to: t.to }
    : { advanced: false, reason: "已被其他实例推进" };
}

/**
 * 分配任务并进入 running。
 *
 * 整个操作在一个事务里：先 CAS 抢到 locked -> running 的推进权，
 * 抢不到就直接回滚返回 false。抢到了才写 assignments。
 * 这样即使 N 个实例同时跑，也只有一个会真的写入。
 *
 * assignments 上的两条唯一索引是第二道防线：万一 CAS 逻辑将来被改坏，
 * DB 也会拒绝重复分配。
 */
export async function performAssignment(db: Db, activityId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(activities)
      .set({ status: "running" })
      .where(and(eq(activities.id, activityId), eq(activities.status, "locked")))
      .returning({ id: activities.id });

    if (claimed.length === 0) return false;

    const rows = await tx
      .select({
        pid: participants.id,
        taskId: tasks.id,
      })
      .from(participants)
      .leftJoin(
        tasks,
        and(
          eq(tasks.activityId, participants.activityId),
          eq(tasks.authorPid, participants.id),
          eq(tasks.status, "accepted"),
        ),
      )
      .where(eq(participants.activityId, activityId));

    const roster = buildRoster(
      rows.map((r) => ({ pid: r.pid, hasAcceptedTask: r.taskId !== null })),
    );
    // 人不够就抛，事务回滚，活动停在 locked 可以重试或由创建者处理
    assertEnoughPlayers(roster);

    const taskOf = new Map(rows.filter((r) => r.taskId).map((r) => [r.pid, r.taskId as string]));
    const perm = assign(roster.players.length);

    await tx.insert(assignments).values(
      roster.players.map((pid, i) => ({
        id: nanoid(),
        activityId,
        // perm[i] 是第 i 个人拿到的题的下标，题的作者是 players[perm[i]]
        taskId: taskOf.get(roster.players[perm[i]]) as string,
        assigneePid: pid,
      })),
    );

    return true;
  });
}

/** scheduler 的一轮：找出所有可能需要推进的活动 */
export async function findAdvanceable(db: Db, now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      sql`${activities.status} = 'locked'
        OR (${activities.status} = 'recruiting' AND ${activities.startAt} <= ${now})
        OR (${activities.status} = 'running'    AND ${activities.endAt} <= ${now})
        OR (${activities.status} = 'voting'     AND ${activities.voteDeadline} <= ${now})`,
    );
  return rows.map((r) => r.id);
}
