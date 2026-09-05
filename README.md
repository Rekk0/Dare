# Dare

**一群人坐在一起，每个人都在偷偷做一件别人指派的事。**

你手上有一道题，是在座某个人写的，你不知道是谁。你要在活动进行中把它做掉，
还不能让别人看出来你在做。同时你手里有几次猜测机会，可以指认某个人正在执行的任务。

猜中了，那个人白干；没人猜中你，大家投票认可你做到了，你拿走奖励。

一场三小时的聚会，从头到尾多出一层暗流。

---

## 一局是怎么走的

```
攒局  →  各自出题  →  开场分配  →  边玩边做、边猜  →  结束揭晓  →  全员投票  →  结算
```

1. **攒局**。创建者定人数、时间、每份奖励是什么（「一首歌点唱权」「20 元」，应用只记账，不碰支付）。
2. **出题**。每人写一道给别人做的任务，AI 先预审：做得到吗、够隐蔽吗、好玩吗、能留下证据吗。不合格会告诉你哪里不行。
3. **分配**。到点自动派发，保证没人拿到自己出的题。任务卡要**长按才显示正文**，防的是旁边那双眼睛。
4. **执行**。偷偷做完，拍照、录音或者录像传上去。
5. **猜测**。活动进行中可以指认别人。**猜中就是一票否决**，那个人的任务直接判失败，不看证据、不看 AI 报告、不进投票。
6. **揭晓与投票**。结束后所有任务、分配关系、证据、AI 报告一次性摊开。对没被猜中的人逐个投票。
7. **结算**。谁被识破了、谁猜中了谁、每人拿几份。

被识破的人**当场就会知道**，一张 BUSTED 卡拍在脸上。瞒着他只会让他白干剩下的时间。

## 奖励怎么算

每道题对应一个固定 **1 份**的独立奖池，这 1 份怎么分只看这一题自己的结果。

| 情形 | 猜中者拿 | 执行者拿 | 作废 |
|---|---|---|---|
| 没人猜中 + 投票通过 | 无 | **1.0** | 0 |
| 没人猜中 + 投票没过 | 无 | 0 | 1.0 |
| 1 人猜中 | **0.5** | 0 | 0.5 |
| 2 人猜中 | **0.5 / 0.3** | 0 | 0.2 |
| 3 人及以上猜中 | **0.5 / 0.3 / 0.2** | 0 | 0 |

每题恒好 1 份（这条是写进数据库 CHECK 约束的，不靠应用层自觉）。所以创建者只要
承诺 N 份就不会超支，N 是这一局的出题人数。

猜测次数随人数走：不足 9 人给 3 次，9 人及以上按人数除以 3。固定 3 次在人多时
会让猜测变成摆设，而被识破是这个游戏最好的情绪节点。

**参与人数 3 到 21 人，同一个物理场景，活动时长 1 到 6 小时。**

## AI 在里面干什么

三件事，都是判断题，不是生成题：

- **出题预审**：给可完成度、隐蔽度、好玩、可留证四个维度打分，不合格给修改意见
- **证据鉴定**：读照片、录音、视频，判断这个任务到底做没做到
- **竞猜裁判**：判断一次猜测算不算命中

**项目不绑定任何一家 AI 厂商。** 用哪家、哪个模型、哪个端点，全在
[providers.yaml](providers.yaml) 里配，代码一行不用改。仓库里带的那份是能跑的示例，
不是推荐，换成你自己的就行。

## 接进你自己的 AI 服务

只有两个 adapter：`openai-compatible` 和 `mock`。

**`openai-compatible` 吃任何符合 OpenAI Chat Completions 格式的端点。** 商业平台、
聚合网关、还是你自己用 vLLM / Ollama / LM Studio / llama.cpp 起的本地服务，
只要给得出 `/v1/chat/completions`，都是同一套配法：

```yaml
providers:
  我的厂商:
    adapter: openai-compatible
    model: 模型名
    apiKeyEnv: MY_API_KEY          # 从哪个环境变量读 key
    baseUrl: https://…/v1          # 写死；或者用 baseUrlEnv 从环境变量读
    stream: true                   # 有些多模态模型强制流式，开着不吃亏
    caps:
      media:                       # 每种媒体它到底吃不吃
        image: native              # native 直接吃
        audio: transcode           # transcode 本地 ASR 转文本再喂
        video: frames              # frames 本地 ffmpeg 抽帧转图片
      limits:
        maxImages: 64
        maxImageBytes: 5242880
        maxAudioSeconds: 3600
        maxVideoSeconds: 300
        maxVideoBytes: 209715200
        maxInlineBytes: 5242880    # 超过这个就得走 URL，不能内联 base64
      structuredOutput: json_mode  # json_schema / json_mode / prompt_only
      fileUpload: false
```

`media` 的第四个取值是 `unsupported`，那种媒体直接放弃。

然后按场景路由，三个场景可以指给不同的 provider：

```yaml
routes:
  taskReview: 便宜的那个        # 出题预审，纯文本
  guessJudge: 便宜的那个        # 竞猜裁判，纯文本
  evidenceReview: 多模态那个    # 证据鉴定，判错了直接影响谁拿钱

fallback:
  evidenceReview:
    - 备用的那个                # 主 provider 失败时依次降级
```

**`caps` 是你的声明，不是事实。** 厂商能力会随模型换代漂移，写错了会在真跑的时候
才炸。用实测去校验声明：

```bash
pnpm providers:check
```

它拿真 key 挨个打一遍，告诉你声明和实测对不对得上。

**不想花钱、不想联网**：`AI_PROFILE=mock` 走 `mock` adapter，不需要任何 key，
全部 AI 逻辑照样跑通。CI 和跑测试用的就是这个。

自部署要自带 key。证据鉴定是多模态判断，本地小模型能不能胜任这项目没验证过，
想试就用 `providers:check` 自己量。

## 一个必须先说清楚的前提

任务保密是个**物理世界问题**，人就坐在你旁边。这个应用能做的是降低泄露概率
（防肩窥的长按揭示、不发通知、列表里不出缩略图），**做不到保证保密**。

乐趣来自难度，不是来自密码学。

---

## 自己跑一个

```bash
pnpm install
cp .env.example .env.local    # 想真调 AI 才需要填 key
pnpm test                      # 322 个测试，不需要 docker
pnpm dev
pnpm scheduler                 # 另开一个终端
```

`.env.local` 不要提交。开发和 CI 保持 `AI_PROFILE=mock` 就不需要 key，也不会调外网。

**要真的开一局，必须给 `DATABASE_URL` 指向真 Postgres。**

留空时用的是 PGlite（Postgres 编译成 WASM，落盘到 `.storage/pgdata`），而 PGlite
是进程内单连接的，两个进程共享不了同一个库。这个应用需要两个进程：web 一个，
推进状态的 scheduler 一个。不配的话 scheduler 扫到的是自己那个空库，活动会永远
停在 recruiting。

```bash
# .env.local
DATABASE_URL=postgres://user:pass@host:5432/dare
```

Supabase、Neon 的免费档，或者本地装一个 Postgres 都行。schema 本来就是 Postgres
方言，一行代码都不用改。

## 为什么值得自部署

证据是隐私内容，照片、录音、视频。自部署时这些东西留在你自己的机器上，不经过
任何第三方。这是相对闭源竞品的真实优势。

项目没有 telemetry。部署者需要自己保管 API key，并了解所选厂商对请求内容的处理政策。

## 部署到自己的服务器

一台 Linux、一个 Postgres、一个反代就够。完整步骤看 [DEPLOY.md](DEPLOY.md)，
里面几条标了「坑」的是真踩过的，跳过任何一条都会得到一个「看起来起来了但用不了」
的部署（表不会自动建、`pnpm install --prod` 起不来 scheduler、本地构建传产物要修软链）。

## 想往里改

- **游戏机制、数据模型、分配算法、结算规则的权威定义** 看 [project-design.md](project-design.md)
- **技术架构、目录结构、模块契约、10 条不变量** 看 [ARCHITECTURE.md](ARCHITECTURE.md)
- **部署** 看 [DEPLOY.md](DEPLOY.md)
- **提 PR 前的规矩** 看 [CONTRIBUTING.md](CONTRIBUTING.md)
- **环境变量清单** 看 [.env.example](.env.example)，每一条都写了不配会怎样
- **AI 厂商配置** 看 [providers.yaml](providers.yaml)，`pnpm providers:check` 能实测当前厂商的真实能力

有两条硬规矩值得先知道：`src/core/` 必须是纯函数（那里放的是算错会发错钱、写错会
泄露任务的逻辑），改它不给测试的 PR 一律打回；任何可见位置都不出现 em-dash。

## 许可

[MIT](LICENSE)
