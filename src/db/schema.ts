import { sql } from "drizzle-orm";
import { DEFAULT_POLICY } from "@/core/review-policy";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema。表结构照 project-design.md §2。
 *
 * **保持 Postgres 方言。** 本地开发和测试跑在 PGlite（Postgres 编译成 WASM）上，
 * 生产是真 Postgres，两边同一套 SQL。不要为了迁就任何一边改类型。
 *
 * 几条不变量直接写进 DB 约束，不靠应用层自觉：
 *   I1  settlements 的三个份额加起来必须恰好等于 1
 *   I3  assignments 的两个唯一索引保证分配是双射
 *   I8  guesses 的部分唯一索引保证同一人对同一目标只占一个名次
 */

const id = () => text("id").primaryKey();
/** 列名必须传进来。写死成 created_at 会让 assigned_at / joined_at 等全部指错列 */
const ts = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const created = () => ts("created_at");

export const users = pgTable("users", {
  id: id(),
  nickname: text("nickname").notNull(),
  avatarEmoji: text("avatar_emoji"),
  deviceTokenHash: text("device_token_hash").notNull(),
  /** 清缓存丢身份时用来找回，见 project-design.md 假设 A4 */
  recoveryCode: text("recovery_code").notNull(),
  createdAt: created(),
});

export const activities = pgTable(
  "activities",
  {
    id: id(),
    code: char("code", { length: 6 }).notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    /** ktv | dinner | trip | board_game | other */
    sceneType: text("scene_type").notNull(),
    /** 自由文本，喂给 AI 做场景约束 */
    sceneDesc: text("scene_desc").notNull().default(""),
    // 默认值只有 DEFAULT_POLICY 一个来源。写死数字的话，
    // 放松下限时这里会被忘掉，然后新建的活动拿到一套旧标准
    minFeasibility: integer("min_feasibility").notNull().default(DEFAULT_POLICY.minFeasibility),
    minStealth: integer("min_stealth").notNull().default(DEFAULT_POLICY.minStealth),
    minFun: integer("min_fun").notNull().default(DEFAULT_POLICY.minFun),
    minVerifiability: integer("min_verifiability").notNull().default(DEFAULT_POLICY.minVerifiability),
    edginess: integer("edginess").notNull().default(DEFAULT_POLICY.edginess),

    taskDeadline: timestamp("task_deadline", { withTimezone: true }).notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    voteDeadline: timestamp("vote_deadline", { withTimezone: true }).notNull(),
    minPlayers: integer("min_players").notNull().default(3),
    maxPlayers: integer("max_players").notNull().default(21),

    /** 创建者定义 1 份是什么，如「一首歌点唱权」 */
    shareDesc: text("share_desc").notNull(),
    shareValue: numeric("share_value", { precision: 12, scale: 2 }),
    /** 前 N 名猜中者各分几份。sum 必须 <= 1，见 §6.1 */
    bountyTiers: numeric("bounty_tiers", { precision: 4, scale: 3 })
      .array()
      .notNull()
      .default(sql`ARRAY[0.5, 0.3, 0.2]::numeric(4,3)[]`),
    /** 每人全场猜测总次数。全局配额，不是每目标 */
    guessQuota: integer("guess_quota").notNull().default(3),
    guessThreshold: integer("guess_threshold").notNull().default(75),
    votePassRatio: numeric("vote_pass_ratio", { precision: 4, scale: 3 })
      .notNull()
      .default("0.5"),

    /** draft | recruiting | locked | running | voting | settled */
    status: text("status").notNull().default("draft"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("activities_code_uq").on(t.code),
    index("activities_status_idx").on(t.status),
    check("activities_time_order", sql`${t.taskDeadline} <= ${t.startAt} AND ${t.startAt} < ${t.endAt} AND ${t.endAt} < ${t.voteDeadline}`),
    check("activities_quota_positive", sql`${t.guessQuota} >= 0`),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /**
     * 这一局里用的名字。可空，为空时回落到 users.nickname。
     *
     * 昵称本来只存在 users 上，是设备级的，改一次名字所有局里都跟着变。
     * 名单读的是 coalesce(participants.nickname, users.nickname)。
     */
    nickname: text("nickname"),
    joinedAt: ts("joined_at"),
    eliminatedAt: timestamp("eliminated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("participants_activity_user_uq").on(t.activityId, t.userId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    authorPid: text("author_pid")
      .notNull()
      .references(() => participants.id),
    /** 强保密字段。读取一律经过 core/visibility.ts */
    content: text("content").notNull(),
    aiReview: jsonb("ai_review"),
    /** draft | rejected | accepted */
    status: text("status").notNull().default("draft"),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // 假设 A1：一人一题
  (t) => [uniqueIndex("tasks_activity_author_uq").on(t.activityId, t.authorPid)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    assigneePid: text("assignee_pid")
      .notNull()
      .references(() => participants.id),
    assignedAt: ts("assigned_at"),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    /** assigned | evidence_submitted | busted | passed | failed */
    status: text("status").notNull().default("assigned"),
    /** 被识破后选了「为面子继续」：证据照传照评审，进揭晓，不给钱 */
    honorOnly: boolean("honor_only").notNull().default(false),
  },
  // 这两条唯一索引就是不变量 I3：分配是双射
  (t) => [
    uniqueIndex("assignments_activity_task_uq").on(t.activityId, t.taskId),
    uniqueIndex("assignments_activity_assignee_uq").on(t.activityId, t.assigneePid),
  ],
);

export const evidences = pgTable("evidences", {
  id: id(),
  assignmentId: text("assignment_id")
    .notNull()
    .references(() => assignments.id, { onDelete: "cascade" }),
  /** image | video | audio */
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  durationMs: integer("duration_ms"),
  /** pending | processing | ready | failed */
  processStatus: text("process_status").notNull().default("pending"),
  /** 降级管线产物。原生多模态厂商时为空 */
  derived: jsonb("derived"),
  uploadedAt: ts("uploaded_at"),
});

export const aiReports = pgTable("ai_reports", {
  id: id(),
  assignmentId: text("assignment_id")
    .notNull()
    .references(() => assignments.id, { onDelete: "cascade" }),
  /** 记录是哪家哪个模型出的。跨厂商时分数不可比，必须留痕 */
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  /** 实际怎么把媒体喂进去的（native / frames x12 / transcript） */
  mediaPlan: jsonb("media_plan"),
  inputDigest: text("input_digest"),
  report: jsonb("report").notNull(),
  usage: jsonb("usage"),
  createdAt: created(),
}, (t) => [uniqueIndex("ai_reports_assignment_uq").on(t.assignmentId)]);

export const guesses = pgTable(
  "guesses",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    guesserPid: text("guesser_pid")
      .notNull()
      .references(() => participants.id),
    targetPid: text("target_pid")
      .notNull()
      .references(() => participants.id),
    text: text("text").notNull(),
    similarity: integer("similarity").notNull(),
    hit: boolean("hit").notNull(),
    /** 有效命中在该 target 上的名次。未命中或作废为 null */
    rank: integer("rank"),
    /**
     * 服务端 only，永不下发给任何人。
     * 里面必然包含任务原文，下发等于白送答案。
     * 对外 DTO 的类型里根本没有这个字段，见 core/visibility.ts。
     */
    rationale: text("rationale"),
    /**
     * 两种作废：出题人猜中自己出的题、执行者猜自己领的任务。
     * 都不占名次、不计赏金、不触发 busted，但照常扣配额。
     */
    voided: boolean("voided").notNull().default(false),
    provider: text("provider"),
    model: text("model"),
    createdAt: created(),
  },
  (t) => [
    index("guesses_activity_target_idx").on(t.activityId, t.targetPid),
    index("guesses_activity_guesser_idx").on(t.activityId, t.guesserPid),
    // 不变量 I8：同一人对同一目标只能占一个名次
    uniqueIndex("guesses_valid_hit_uq")
      .on(t.activityId, t.guesserPid, t.targetPid)
      .where(sql`${t.hit} AND NOT ${t.voided}`),
    check("guesses_similarity_range", sql`${t.similarity} BETWEEN 0 AND 100`),
    // 自己猜自己在应用层也要拦，这里是最后一道
    check("guesses_no_self", sql`${t.guesserPid} <> ${t.targetPid}`),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    voterPid: text("voter_pid")
      .notNull()
      .references(() => participants.id),
    /** pass | fail */
    verdict: text("verdict").notNull(),
    score: integer("score"),
    comment: text("comment"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("votes_assignment_voter_uq").on(t.assignmentId, t.voterPid),
    check("votes_verdict_enum", sql`${t.verdict} IN ('pass', 'fail')`),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** busted | passed | failed */
    outcome: text("outcome").notNull(),
    passRatio: numeric("pass_ratio", { precision: 5, scale: 4 }),
    voteCount: integer("vote_count"),
    /** 投票人数不足，由 AI 报告兜底 */
    fallbackByAi: boolean("fallback_by_ai").notNull().default(false),
    toAssignee: numeric("to_assignee", { precision: 4, scale: 3 }).notNull(),
    toGuessers: numeric("to_guessers", { precision: 4, scale: 3 }).notNull(),
    forfeited: numeric("forfeited", { precision: 4, scale: 3 }).notNull(),
    settledAt: ts("settled_at"),
  },
  (t) => [
    uniqueIndex("settlements_assignment_uq").on(t.assignmentId),
    // 不变量 I1：每题恰好 1 份。写进 DB，不靠应用层自觉
    check(
      "settlements_conserves_one_share",
      sql`${t.toAssignee} + ${t.toGuessers} + ${t.forfeited} = 1`,
    ),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    taskShares: numeric("task_shares", { precision: 4, scale: 3 }).notNull(),
    bountyShares: numeric("bounty_shares", { precision: 6, scale: 3 }).notNull(),
    totalShares: numeric("total_shares", { precision: 6, scale: 3 }).notNull(),
    /** 自己的任务是否被识破 */
    busted: boolean("busted").notNull().default(false),
    hitTargetPids: text("hit_target_pids").array().notNull().default(sql`ARRAY[]::text[]`),
    settledAt: ts("settled_at"),
  },
  (t) => [uniqueIndex("payouts_activity_participant_uq").on(t.activityId, t.participantId)],
);
