# Dare

线下派对暗任务游戏。每人秘密执行一个别人出的任务，AI 做证据鉴定和竞猜裁判，最后全员公投决定谁拿奖励。

## 为什么值得自部署

证据是用户的隐私内容，包括照片、录音和视频。自部署时，数据完全留在部署者自己的机器上，不经过任何第三方。这是相对闭源竞品的真实优势。

## 数据库：要真开一局必须给 DATABASE_URL

留空 `DATABASE_URL` 时用 PGlite（Postgres 编译成 WASM，落盘到 `.storage/pgdata`）。
**PGlite 是进程内单连接的，两个进程不能共享同一个库。**

而这个应用需要两个进程：`pnpm dev` 跑 web，`pnpm scheduler` 跑状态推进
（自动分配任务、开投票、结算）。实测下来 scheduler 会扫到 0 个活动，
因为它看的是自己那个空库。

所以：

- **跑测试、单进程开发** -> 不用配，PGlite 够用
- **真的开一局** -> 必须给 `DATABASE_URL` 指向真 Postgres

```bash
# .env.local
DATABASE_URL=postgres://user:pass@host:5432/dare
```

Supabase、Neon 的免费档，或者本地装一个 Postgres 都行。
schema 本来就是 Postgres 方言，不需要改任何代码。


## 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填 DASHSCOPE_API_KEY
pnpm test                     # 199 个测试，无需 docker
pnpm dev
pnpm scheduler                # 另开一个终端
```

`.env.local` 不要提交。开发和 CI 可以保持 `AI_PROFILE=mock`，这样不需要 API key，也不会调用外网。

## AI 厂商

默认使用阿里百炼的 Qwen3.5-Omni，一个模型处理文本、图像、音频和视频。运行 `pnpm providers:check` 可以实测当前厂商能力。

换厂商只需要修改 [providers.yaml](providers.yaml)。`openai-compatible` adapter 覆盖百炼、智谱、硅基流动等一大片兼容平台。

本项目不提供纯本地零成本方案。多模态判定必须外接商用 API，部署者需要自带 key。

## 隐私与数据

本项目没有 telemetry。

部署者应妥善保管 API key，并了解所选 AI 厂商对请求内容的处理政策。

## 文档

- 想了解游戏机制，请看 [project-design.md](project-design.md)。
- 想了解技术架构，请看 [ARCHITECTURE.md](ARCHITECTURE.md)。
- 想参与开发，请看 [CONTRIBUTING.md](CONTRIBUTING.md)。
