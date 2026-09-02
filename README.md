# Dare

线下派对暗任务游戏。每人秘密执行一个别人出的任务，AI 做证据鉴定和竞猜裁判，最后全员公投决定谁拿奖励。

## 为什么值得自部署

证据是用户的隐私内容，包括照片、录音和视频。自部署时，数据完全留在部署者自己的机器上，不经过任何第三方。这是相对闭源竞品的真实优势。

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
