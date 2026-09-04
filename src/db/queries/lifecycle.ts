import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assign } from "@/core/assign";
import { reviewEvidence } from "@/ai/tasks/evidenceReview";
import { LocalStorage } from "@/storage/local";
import {
  assertPlayerCount,
  buildRoster,
  guessQuotaFor,
  nextTransition,
  type ActivitySchedule,
  type Transition,
} from "@/core/lifecycle";
import type { ActivityStatus } from "@/core/visibility";
import type { Db } from "../client";
import { activities, aiReports, assignments, evidences, participants, tasks } from "../schema";
import { settleActivity } from "./settlement";

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
      taskDeadline: activities.taskDeadline,
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
    taskDeadline: r.taskDeadline,
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
    const ok = await performAssignment(db, activityId, now);
    return ok
      ? { advanced: true, from: t.from, to: t.to }
      : { advanced: false, reason: "已被其他实例分配" };
  }

  if (t.action === "settle") {
    const result = await settleActivity(db, activityId);
    return result.settled
      ? { advanced: true, from: t.from, to: t.to }
      : { advanced: false, reason: result.reason };
  }

  const ok = await casStatus(db, activityId, t.from, t.to);
  if (ok && t.action === "openVoting") {
    await reviewActivityEvidence(db, activityId);
  }
  return ok
    ? { advanced: true, from: t.from, to: t.to }
    : { advanced: false, reason: "已被其他实例推进" };
}

const AI_EVIDENCE_SIGNED_URL_TTL_MS = 30 * 60 * 1000;

/** 一轮最多补几局，免得一次扫描把调度器占死 */
const EVIDENCE_SWEEP_LIMIT = 3;

/**
 * 把漏跑的证据评审补上。
 *
 * 评审只在 running -> voting 那一次触发，而它是个几十秒起步的慢活：
 * 进程正好在这中间重启，剩下的 assignment 就永远没有报告了 -
 * 状态已经过了 voting，openVoting 不会再触发第二次。
 *
 * 所以调度器每轮扫一遍：还在 voting 或者已经 settled、
 * 但底下有 assignment 没报告的局，重新跑一次。
 * reviewActivityEvidence 本身是幂等的（有报告就跳过），补跑不会写重。
 */
export async function sweepPendingEvidenceReports(db: Db): Promise<string[]> {
  const pending = await db
    .selectDistinct({ activityId: assignments.activityId })
    .from(assignments)
    .innerJoin(activities, eq(activities.id, assignments.activityId))
    .leftJoin(aiReports, eq(aiReports.assignmentId, assignments.id))
    .where(and(inArray(activities.status, ["voting", "settled"]), isNull(aiReports.id)))
    .limit(EVIDENCE_SWEEP_LIMIT);

  const done: string[] = [];
  for (const row of pending) {
    try {
      await reviewActivityEvidence(db, row.activityId);
      done.push(row.activityId);
    } catch (error) {
      // 补跑失败不能影响调度器的其余工作，下一轮还会再试
      console.error("补跑证据评审失败", { activityId: row.activityId, error });
    }
  }
  return done;
}

/**
 * 投票已开启后才跑证据评审。故意不放在状态推进事务里，AI 慢或失败都不能卡住公投。
 */
export async function reviewActivityEvidence(db: Db, activityId: string): Promise<void> {
  let warnedMissingBaseUrl = false;

  const rows = await db
    .select({
      assignmentId: assignments.id,
      taskContent: tasks.content,
      sceneDesc: activities.sceneDesc,
    })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .innerJoin(activities, eq(assignments.activityId, activities.id))
    .where(eq(assignments.activityId, activityId));

  for (const assignment of rows) {
    try {
      const existing = await db
        .select({ id: aiReports.id })
        .from(aiReports)
        .where(eq(aiReports.assignmentId, assignment.assignmentId));
      if (existing.length > 0) continue;

      const media = await db
        .select({
          id: evidences.id,
          kind: evidences.kind,
          storageKey: evidences.storageKey,
          mime: evidences.mime,
          bytes: evidences.bytes,
          durationMs: evidences.durationMs,
        })
        .from(evidences)
        .where(eq(evidences.assignmentId, assignment.assignmentId));

      if (media.length === 0) {
        await db.insert(aiReports).values({
          id: nanoid(),
          assignmentId: assignment.assignmentId,
          provider: "system",
          model: "none",
          report: { summary: "没有提交证据。" },
        }).onConflictDoNothing();
        continue;
      }

      // 证据是**厂商来拉**的，给的必须是公网可达的绝对地址。
      // 不设 PUBLIC_BASE_URL 时 signDownload 返回的是 /api/storage/... 这样的相对路径，
      // 厂商只会回一句 "The provided URL does not appear to be valid" -
      // 报错完全指不到这个环境变量上，第一次踩要查很久。
      //
      // 跳过时**不写报告**：留给调度器的补跑在配好之后重新评一次。
      // 写一条占位报告的话，幂等检查会认为已经评过，真正的评审再也不会发生。
      if (!process.env.PUBLIC_BASE_URL) {
        if (!warnedMissingBaseUrl) {
          warnedMissingBaseUrl = true;
          console.warn(
            "[证据评审] 跳过带证据的评审：没设 PUBLIC_BASE_URL，厂商拉不到文件。" +
              "本地局域网测试下这是正常的，部署时必须配上，见 DEPLOY.md。",
          );
        }
        continue;
      }

      await db
        .update(evidences)
        .set({ processStatus: "processing" })
        .where(eq(evidences.assignmentId, assignment.assignmentId));

      const storage = new LocalStorage();
      const result = await reviewEvidence({
        taskContent: assignment.taskContent,
        sceneDesc: assignment.sceneDesc,
        evidences: media.map((item) => ({
          kind: item.kind as "image" | "audio" | "video",
          storageKey: item.storageKey,
          mime: item.mime,
          bytes: item.bytes,
          durationMs: item.durationMs ?? undefined,
        })),
        resolveUrl: (key) => storage.signDownload(key, AI_EVIDENCE_SIGNED_URL_TTL_MS),
      });

      await db.insert(aiReports).values({
        id: nanoid(),
        assignmentId: assignment.assignmentId,
        provider: result.provider,
        model: result.model,
        mediaPlan: result.mediaPlan,
        report: result.report,
      }).onConflictDoNothing();
      await db
        .update(evidences)
        .set({ processStatus: "ready" })
        .where(eq(evidences.assignmentId, assignment.assignmentId));
    } catch (error) {
      await db
        .update(evidences)
        .set({ processStatus: "failed" })
        .where(eq(evidences.assignmentId, assignment.assignmentId));
      console.error("证据评审失败", { activityId, assignmentId: assignment.assignmentId, error });
    }
  }
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
export async function performAssignment(db: Db, activityId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(activities)
      .set({ status: "assigned" })
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
      .where(and(eq(participants.activityId, activityId), isNull(participants.eliminatedAt)));

    const roster = buildRoster(
      rows.map((r) => ({ pid: r.pid, hasAcceptedTask: r.taskId !== null })),
    );
    // 人数不合规就抛，事务回滚，活动停在 locked 可以重试或由创建者处理
    const activity = (await tx.select({ minPlayers: activities.minPlayers, maxPlayers: activities.maxPlayers }).from(activities).where(eq(activities.id, activityId)))[0];
    if (!activity) throw new Error("活动不存在");
    assertPlayerCount(roster, activity.minPlayers, activity.maxPlayers);

    if (roster.spectators.length) {
      await tx.update(participants).set({ eliminatedAt: now }).where(and(eq(participants.activityId, activityId), inArray(participants.id, roster.spectators)));
    }

    // 配额按实际参与分配的人数定，在这里写死进活动。
    // 固定 3 次在人多时会让猜测变成摆设：20 个目标里猜 3 次几乎不可能命中，
    // 而被识破是这个游戏最好的情绪节点。
    await tx
      .update(activities)
      .set({ guessQuota: guessQuotaFor(roster.players.length) })
      .where(eq(activities.id, activityId));

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
  // 原始 sql 模板里 drizzle 拿不到列类型，裸 Date 会原样透传给驱动。
  // PGlite 吃得下，postgres-js 吃不下（Received an instance of Date），
  // 于是这个 bug 只在真 Postgres 上炸，测试全绿也发现不了。
  // 转成 ISO 串再显式转型，两个驱动都认。
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      sql`${activities.status} = 'locked'
        OR (${activities.status} = 'recruiting' AND ${activities.taskDeadline} <= ${at})
        OR (${activities.status} = 'assigned' AND ${activities.startAt} <= ${at})
        OR (${activities.status} = 'running'    AND ${activities.endAt} <= ${at})
        OR (${activities.status} = 'voting'     AND ${activities.voteDeadline} <= ${at})`,
    );
  return rows.map((r) => r.id);
}
