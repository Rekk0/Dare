<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Dare — 项目规则

线下派对暗任务游戏。移动端 Web，开源。

## 必读文档（改代码前先读相关的那份）

| 文件 | 管什么 |
|---|---|
| `project-design.md` | 产品机制、数据模型、奖励与保密规则（**权威**） |
| `ARCHITECTURE.md` | 技术栈、目录、模块契约、10 条不变量 |
| `DESIGN.md` | 视觉规范、交互规格、反 AI 味清单 |
| `IMPLEMENT-PLAN.md` | 里程碑与验收标准 |
| `PROGRESS.md` | 当前进度、决策日志、已知的坑 |

## 硬规则

1. **手术式改动**。只动必须动的。不顺带重构、不顺带格式化、不动没坏的东西。
2. **`src/core/` 必须是纯函数**。无 IO、无 DB、无 fetch、无 Date.now()（时间从参数传入）。
   这里放的是「算错会发错钱」和「写错会泄露任务」的逻辑，必须能被穷举验证。
   **改 `core/` 不给测试的 PR 一律打回。**
3. **零 em-dash**。代码注释、UI 文案、文档，任何可见位置都不出现 `—` 或 `–`，用普通连字符 `-`。
4. **UI 文案写中文，不写客服腔**。「这一份，没了。」不是「很遗憾，您本次的奖励份额将不予发放」。
5. **不要把任务正文或 AI rationale 放进任何 API 响应类型**，除非可见性规则明确允许。
   用 TypeScript 类型在编译期杜绝，不靠自觉。
6. 注释和提交信息写中文。代码标识符写英文。

## 测试

```bash
pnpm test          # vitest run
pnpm test:watch
```

`core/` 的测试用 `vitest` + `fast-check`（property test）。

## 当前环境限制

- **本机没有 docker**。M2 起数据库用 PGlite（`@electric-sql/pglite`，Postgres 编译成 WASM，进程内跑）。
  生产环境仍是真 Postgres，schema 保持 Postgres 方言。
- 没有任何 AI 厂商的 API key。所有 AI 相关代码必须能用 `MockProvider` 跑通测试。
