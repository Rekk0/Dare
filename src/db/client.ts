import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * 数据库连接。
 *
 * 本机没有 docker，所以本地开发和测试跑 PGlite（Postgres 编译成 WASM，进程内跑）。
 * 生产是真 Postgres。两边同一套 Postgres 方言的 SQL，schema 不做任何迁就。
 *
 * 生产驱动（postgres-js 或 node-postgres）到部署时再接，
 * 现在装它只会多一个用不上的依赖。
 */

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

export interface MemoryDb {
  db: Db;
  /**
   * 原始 PGlite 句柄。
   * `db.execute()` 走预处理语句，一次只能一条命令；多条 SQL 的建表和造数
   * 必须用 `client.exec()`。
   */
  client: PGlite;
  close: () => Promise<void>;
}

/** 起一个内存库。每个测试用例一个，互不污染 */
export async function createMemoryDb(): Promise<MemoryDb> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await applySchema(client);
  return { db, client, close: () => client.close() };
}

/**
 * 建表。
 *
 * 这里手写 DDL 而不是用 drizzle-kit 生成的迁移文件，是因为测试要的是
 * 「一个干净的库，立刻可用」。生产的迁移仍然走 drizzle-kit，
 * 两者由 `pnpm db:check` 比对（M2 之后补）。
 */
export async function applySchema(client: PGlite): Promise<void> {
  await client.exec(DDL);
}

export const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  nickname text NOT NULL,
  avatar_emoji text,
  device_token_hash text NOT NULL,
  recovery_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id text PRIMARY KEY,
  code char(6) NOT NULL,
  creator_id text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  scene_type text NOT NULL,
  scene_desc text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  vote_deadline timestamptz NOT NULL,
  share_desc text NOT NULL,
  share_value numeric(12,2),
  bounty_tiers numeric(4,3)[] NOT NULL DEFAULT ARRAY[0.5, 0.3, 0.2]::numeric(4,3)[],
  guess_quota integer NOT NULL DEFAULT 3,
  guess_threshold integer NOT NULL DEFAULT 75,
  vote_pass_ratio numeric(4,3) NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_time_order CHECK (start_at < end_at AND end_at < vote_deadline),
  CONSTRAINT activities_quota_positive CHECK (guess_quota >= 0)
);
CREATE UNIQUE INDEX activities_code_uq ON activities (code);
CREATE INDEX activities_status_idx ON activities (status);

CREATE TABLE participants (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX participants_activity_user_uq ON participants (activity_id, user_id);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  author_pid text NOT NULL REFERENCES participants(id),
  content text NOT NULL,
  ai_review jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tasks_activity_author_uq ON tasks (activity_id, author_pid);

CREATE TABLE assignments (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks(id),
  assignee_pid text NOT NULL REFERENCES participants(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  first_opened_at timestamptz,
  status text NOT NULL DEFAULT 'assigned',
  honor_only boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX assignments_activity_task_uq ON assignments (activity_id, task_id);
CREATE UNIQUE INDEX assignments_activity_assignee_uq ON assignments (activity_id, assignee_pid);

CREATE TABLE evidences (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL,
  duration_ms integer,
  process_status text NOT NULL DEFAULT 'pending',
  derived jsonb,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_reports (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  media_plan jsonb,
  input_digest text,
  report jsonb NOT NULL,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guesses (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  guesser_pid text NOT NULL REFERENCES participants(id),
  target_pid text NOT NULL REFERENCES participants(id),
  text text NOT NULL,
  similarity integer NOT NULL,
  hit boolean NOT NULL,
  rank integer,
  rationale text,
  voided boolean NOT NULL DEFAULT false,
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guesses_similarity_range CHECK (similarity BETWEEN 0 AND 100),
  CONSTRAINT guesses_no_self CHECK (guesser_pid <> target_pid)
);
CREATE INDEX guesses_activity_target_idx ON guesses (activity_id, target_pid);
CREATE INDEX guesses_activity_guesser_idx ON guesses (activity_id, guesser_pid);
CREATE UNIQUE INDEX guesses_valid_hit_uq ON guesses (activity_id, guesser_pid, target_pid)
  WHERE hit AND NOT voided;

CREATE TABLE votes (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  voter_pid text NOT NULL REFERENCES participants(id),
  verdict text NOT NULL,
  score integer,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_verdict_enum CHECK (verdict IN ('pass', 'fail'))
);
CREATE UNIQUE INDEX votes_assignment_voter_uq ON votes (assignment_id, voter_pid);

CREATE TABLE settlements (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  pass_ratio numeric(5,4),
  vote_count integer,
  fallback_by_ai boolean NOT NULL DEFAULT false,
  to_assignee numeric(4,3) NOT NULL,
  to_guessers numeric(4,3) NOT NULL,
  forfeited numeric(4,3) NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_conserves_one_share
    CHECK (to_assignee + to_guessers + forfeited = 1)
);
CREATE UNIQUE INDEX settlements_assignment_uq ON settlements (assignment_id);

CREATE TABLE payouts (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES participants(id),
  task_shares numeric(4,3) NOT NULL,
  bounty_shares numeric(6,3) NOT NULL,
  total_shares numeric(6,3) NOT NULL,
  busted boolean NOT NULL DEFAULT false,
  hit_target_pids text[] NOT NULL DEFAULT ARRAY[]::text[],
  settled_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payouts_activity_participant_uq ON payouts (activity_id, participant_id);
`;

export { schema };
