# Dare — 架构

> 稳定参考文档。技术形状变了才改这里；进度和待办在 [PROGRESS.md](PROGRESS.md)。
> 配套：[project-design.md](project-design.md)（产品与机制）、[DESIGN.md](DESIGN.md)（视觉）、[IMPLEMENT-PLAN.md](IMPLEMENT-PLAN.md)（里程碑）。

---

## 1. 技术栈（已定稿）

| 层 | 选型 | 定这个的理由 |
|---|---|---|
| 框架 | Next.js 16 App Router + TypeScript | 移动端 Web，扫码即用，无应用商店审核。对「线下临时开一局」是决定性优势 |
| 样式 | Tailwind v4，色值走 CSS 变量 | 变量表见 DESIGN.md §1 |
| 动效 | `motion/react` | 不引 GSAP：本项目没有滚动叙事需求 |
| 图标 | `@phosphor-icons/react`，strokeWidth 1.5 | 单一图标族 |
| 组件 | shadcn/ui 打底，必须改默认圆角/配色/字体 | 不允许原样使用 |
| 后端 | Next.js Route Handlers（同仓） | N ≤ 12、并发极低，不需要独立服务 |
| 数据库 | Postgres + Drizzle ORM。**本地用 PGlite** | 分配和结算需要事务。见下方「本机没有 docker」 |
| 对象存储 | S3 兼容（本地 MinIO / 线上 R2） | 预签名直传，大视频不过 app server |
| 队列 | BullMQ + Redis | AI 调用、媒体处理是慢任务 |
| AI | 自研 provider 抽象层，默认 Gemini | 开源不绑厂商，见 §4 |
| 部署 | 单机 Docker Compose | 用户量决定了不需要 k8s |

> **实际落地（2026-09-02）**：Next.js **16.3.4**、Tailwind v4、vitest 4、fast-check 4、
> drizzle-orm 0.45、@electric-sql/pglite 0.5。
>
> **本机没有 docker。** 本地开发与测试用 **PGlite**（Postgres 编译成 WASM，进程内跑，真 Postgres 语义），
> 生产仍是真 Postgres，**schema 保持 Postgres 方言**，不为迁就 PGlite 改类型。
> Redis / MinIO 同理推迟到真正需要它们的里程碑（M3 队列、M4 对象存储）再决定怎么替代。

---

## 2. 进程模型

```
web       Next.js（页面 + API Route Handlers）
worker    BullMQ 消费者
            ai.taskReview      出题预审（同步等待，但走队列保证重试）
            ai.evidenceReview  证据评审
            ai.guessJudge      猜测判定
            media.transcode    ffmpeg 抽帧 / ASR —— Phase 2 才有
scheduler  30s 轮询推进 activity 状态
            locked        → 执行分配
            end_at        → voting
            vote_deadline → settle
```

**scheduler 的每一步都必须幂等**：`UPDATE activities SET status=$next WHERE id=$id AND status=$expected RETURNING *`，
拿到行才继续。worker 重启不会重复分配、不会重复发钱。

---

## 3. 目录结构

```
src/
  core/                    纯业务逻辑，无 IO，可单测
    assign.ts              derangement 分配
    settle.ts              结算引擎（守恒的唯一实现）
    visibility.ts          可见性矩阵（保密的唯一实现）
    bounty.ts              命中名次 → 赏金份额
    types.ts
  ai/
    types.ts               AiProvider / AiRequest / ProviderCapabilities
    planner.ts             MediaPlanner：能力 → 媒体处理计划
    validate.ts            parseAndValidate，跨厂商统一
    registry.ts            读 providers.yaml，按 route 取 provider
    adapters/
      google-genai.ts
      anthropic.ts
      openai-compatible.ts
      mock.ts
    tasks/
      taskReview.ts        prompt + schema + 判定规则
      evidenceReview.ts
      guessJudge.ts
  db/
    schema.ts              Drizzle schema
    migrations/
    queries/               按聚合分文件，读查询一律经过 visibility
  jobs/                    BullMQ 定义与 worker
  app/                     Next.js 路由与页面
  components/
    Redacted.tsx           整块涂黑 + 长按擦开（核心组件）
    BustedScreen.tsx       被识破全屏
    ...
scripts/
  providers-check.ts       厂商能力自检
  subset-fonts.ts          字体子集化
providers.yaml
docker-compose.yml
```

### 为什么 `core/` 要独立成无 IO 的纯模块

`settle.ts` 和 `visibility.ts` 是这个项目仅有的两处「错了会很惨」的逻辑：
一个算错就发错钱，一个写错就泄露任务。**把它们做成纯函数，才能用 property test 穷举验证**。
任何一处业务逻辑散进 route handler，就等于放弃了验证。

---

## 4. AI 层：三段式

```
业务层  taskReview / evidenceReview / guessJudge
          只构造归一化的 AiRequest，不知道底下是谁
   ↓
MediaPlanner
          读 provider.caps，把原始媒体规划成这家能吃的形式
            native    直传（或走该厂商的 file upload）
            frames    ffmpeg 抽帧 → N 个 image part
            transcode ASR → text part
          再按 limits 裁剪（帧数上限 / 时长截断 / 体积压缩）
   ↓
ProviderAdapter
          只做一件事：把归一化请求翻成这家的 wire format
```

**降级逻辑放 MediaPlanner，不放 adapter。** 否则每加一家厂商都要重写一遍抽帧和 ASR。
Adapter 保持薄，只序列化。

### 能力声明

```ts
type MediaKind = 'image' | 'audio' | 'video';
type Support = 'native' | 'frames' | 'transcode' | 'unsupported';

interface ProviderCapabilities {
  id: string;
  media: Record<MediaKind, Support>;
  limits: {
    maxImages: number; maxImageBytes: number;
    maxAudioSeconds: number; maxVideoSeconds: number;
    maxVideoBytes: number; maxInlineBytes: number;
  };
  structuredOutput: 'json_schema' | 'json_mode' | 'prompt_only';
  fileUpload: boolean;
}
```

`caps` 由 `providers.yaml` 声明，**不硬编码**。用 `scripts/providers-check.ts` 实测校验——
厂商到底支不支持视频，让代码去问，不靠文档也不靠记忆。

### 结构化输出的三档降级

```
json_schema  厂商原生 schema 约束
json_mode    只保证合法 JSON，服务端 zod 校验，不过重试 1 次
prompt_only  prompt 贴 schema + few-shot，抽 json 块，zod 校验，重试 2 次
```

三档最终都过同一个 `parseAndValidate(schema, raw)`，业务层拿到的永远是校验过的对象。

---

## 5. 关键不变量

违反任何一条都是 P0。每条都要有对应的测试。

| # | 不变量 | 强制手段 |
|---|---|---|
| I1 | **每题恰好 1 份**：`to_assignee + to_guessers + forfeited = 1` | DB CHECK 约束 + `settle.ts` 单测 |
| I2 | **全场总额守恒**：`Σ payouts.total + Σ forfeited = assignments.length`。注意分母是**任务数不是人数** —— 有旁观者（未出题者仍可投票和猜）时人数 > 任务数 | 结算后断言 + property test（随机命中/投票组合） |
| I3 | **分配是 derangement**：无人拿到自己出的题，且一一对应 | `assign.ts` 单测 + 两个 DB 唯一索引 |
| I4 | **`running` 期间任务正文只对执行者可见** | 全部读查询经过 `visibility.ts`；每条可见性规则一个测试 |
| I5 | **出题者永远不知道自己的题给了谁**（直到 `settled`） | 同上 |
| I6 | **`rationale` 永不下发给任何人** | 该字段不出现在任何 API 响应类型里（类型层面杜绝） |
| I7 | **两种作废命中**：①出题人猜中自己出的题 ②**执行者猜自己领的任务**。都不触发 busted、不占名次、不计赏金，但扣配额。②是可套利的：明知完不成（拿 0 份）时猜自己，把自己搞成 busted 再以第一名领 0.5 份 | `bounty.ts` 的 `isVoidedHit()`，单测覆盖两种 case |
| I8 | **命中名次在事务内确定** | `SELECT ... FOR UPDATE` + 唯一部分索引 |
| I9 | **状态推进幂等** | 全部走 `UPDATE ... WHERE status=$expected` |
| I10 | **识破者身份在 `settled` 前不下发** | 猜测响应里只有 `rank` 和自己的赏金，无 guesser 身份；`/reveal` 之前的响应类型不含该字段 |

---

## 6. 核心数据流

```
出题
  POST /tasks → ai.taskReview（同步等）→ 写 tasks.ai_review
              → safety=block 直接 reject
              → feasibility<40 给建议但允许坚持提交

分配（scheduler，start_at 触发）
  事务 { derangement → 写 N 条 assignments → status=running }

上传
  POST /evidence/sign → 预签名 URL → 客户端直传 S3
  POST /evidence      → 入库 + 入队 ai.evidenceReview

猜测
  POST /guesses → ai.guessJudge → similarity
    事务 {
      SELECT count(*) FOR UPDATE 定 rank
      INSERT guesses(rank)
      第一名 → UPDATE assignments SET status='busted'
    }
  响应只回 { hit|close|cold, quotaLeft, rank?, bountyShares? }

被识破者下次打开任务卡
  GET /my-assignment 返回 status='busted' → 前端播 BustedScreen（每人只全屏播一次）

结算（scheduler，vote_deadline 触发）
  事务 {
    每个 assignment → settlements（busted 优先于公投）
    每个 participant → payouts
    断言 I2
    status=settled
  }
```

---

## 7. 环境与配置

```bash
DATABASE_URL=postgres://...
REDIS_URL=redis://...
S3_ENDPOINT= S3_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY=
GOOGLE_API_KEY=          # 默认 provider
ANTHROPIC_API_KEY=       # 可选
DASHSCOPE_API_KEY=       # 可选
AI_PROFILE=mock          # mock | live，CI 和本地开发用 mock 不烧钱
```

`providers.yaml` 按场景路由：

```yaml
default: gemini
providers:
  gemini:   { adapter: google-genai,      model: gemini-2.5-pro, apiKeyEnv: GOOGLE_API_KEY }
  claude:   { adapter: anthropic,         model: claude-opus-5,  apiKeyEnv: ANTHROPIC_API_KEY }
  mock:     { adapter: mock }
routes:
  taskReview:     gemini
  evidenceReview: gemini
  guessJudge:     gemini
fallback:
  evidenceReview: [claude]
```

**仓库不含任何 key**，只给 `.env.example`。`MockProvider` 是必需品，不是可选项。

---

## 8. 本地开发

```bash
docker compose up -d          # postgres + redis + minio
pnpm db:migrate
pnpm dev                      # web
pnpm worker                   # worker + scheduler
pnpm providers:check          # 厂商能力自检（需要真 key）
```

---

## 9. 开源约束

- 无 telemetry。证据是用户隐私内容，**自部署时数据完全留在部署者机器上，这是相对闭源竞品的真实优势**，README 要写。
- `docker compose up` 一条命令起全栈。
- 明确说明：本项目不提供纯本地零成本方案，多模态判定必须外接商用 API，部署者自带 key。
- 内置每活动 AI 调用次数上限，防部署者的 key 被刷。
