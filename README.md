# AI TokTok

沉浸式 IP 互动叙事沙盒。上传一段故事文本，AI 会把它解析成可探索的世界（角色、地点、时间线），你选择"魂穿"已有角色或让 AI 生成一个转生身份介入其中，与世界实时交互并产生你独有的分支剧情。故事结束后，每个与你交集过的角色会以自己的语气写下对你的回忆。

纯客户端应用 — 浏览器直接调用 OpenAI / Anthropic API，无后端、无账号系统。

## 本地启动

```bash
./start.sh
```

或者手动：

```bash
npm install
npm run dev
```

打开 http://localhost:3000

> API 密钥在首页填入，保存在浏览器 `localStorage`，不会发到任何服务器。

## 功能概览

### 故事解析 · 增量图谱构建
- 上传任意长度的 `.txt` / `.md` 故事文本
- 解析器按段落切片，串行喂给 LLM。每一片的 prompt 都带上前序片累积出的"已知角色/地点/世界观"，引导模型复用主名、消解别名（"林公子 → 林宇"、"他/那人"指代）。
- **片内流式渲染进度**：每片的 LLM 调用用 `streamLLMBrowser` 边接收边推进进度条，按字符数估算，不会卡在 5% 干等。
- **续传快照**：每片处理完后快照落盘（按 `sha256(fullText) + chunkIndex` 做 key）。失败重试自动从最高成功点续传——中断过的长故事不会白跑。
- 每片独立重试 3 次（500ms / 2s / 5s 指数退避）。
- 全部解析完走一次小型 LLM 润色，生成统一的标题、梗概、基调、时间线。
- 对第一人称视角主角特别处理：即使主角只被"我/他/她"代称也强制纳入角色列表（魂穿模式才能选到）。

### 介入方式
- **魂穿**：扮演故事中的既有角色
- **转生**：AI 按世界观生成一个全新原创角色让你代入
- 可选择从任意关键事件节点切入故事
- 双变量护栏 + 叙事/对话比重：温度、严谨度、narrative weight 实时调节 LLM 行为

### 互动游玩
- **聊天气泡式叙事流**：narration / 角色对白 / 玩家动作 / 系统事件视觉上分明，玩家对白右对齐金色气泡。
- **多层次流式渲染**：
  - `narration` 字段边流边显示为散文段落（JSON 结构字符被实时过滤）
  - `dialogues` 数组里的每一句对白**一条条浮现**——闭合一条出一条，最后一条未闭合的以"正在开口…"+ 打字光标形式滚动展现，不再卡大块停顿
- **选项推进**：每轮 2-3 个"具体行动"选项；选项按钮和自由输入走相同的推进路径，不会出现"点几次选项才推一点剧情"的循环（prompt 里明令禁止使用"继续观察""再等等"这类原地踏步的选项）。
- **剧情推进规则**：系统 prompt 强制每回合必须有实质事件发生，禁止换措辞复述同一场景。

### @ 提及系统（类 Claude Code）
输入 `@` 弹出候选面板：
- **系统**（◎ 总在第一位）：咨询提示、澄清规则、提示可做什么；回应**不进入剧情历史**、不推进故事、不触发自动存档，像"小声耳语"。
- **在场角色**（绿点）：最近 5 轮叙事里出现过的角色，可 @ 与之互动。
- **不在场角色**（灰点）：曾出现但当前已离场，列在末尾，**不可选择**（键盘跳过、点击无效、陪衬标"不在场"）。
- 候选项随故事进展实时变化。
- **系统与角色同回合互斥**：一旦 @ 了其中一类，另一类自动灰掉，避免意图歧义。
- Mention 以原子 chip 形式占位，点 × 或键盘 Backspace 可删。

### 档案与结局
- **运行时状态持久化**：Zustand 中间件把游戏中的 parsedStory / playerConfig / narrativeHistory 等落到 `localStorage`，页面刷新或路由切换不丢状态。
- **自动存档**：每次叙事完成后写入存档。
- **回顾模式**：按时间轴重放整段故事 + 角色好感统计（正面/中立/负面 stack 进度条）。
- **后日谈流式生成**：点击"结束故事"立即跳转到 `/epilogue` 页面，生成过程在这里进行——
  - 顶部 determinate 进度条（`已完成 N / 总数 M`）
  - 每位角色的回忆**一张张浮现**（LLM 返回的 JSON 数组用 partial-JSON 解析器边流边解）
  - 最后一位回忆的卡片带打字光标实时写作
  - 回忆基于**本次游玩的完整叙事记录 + 角色 personality + 情感轨迹**生成，不是原作剧情的改写

## 技术栈

- **Next.js 16**（App Router, static export to GitHub Pages）
- **React 19**（contenteditable MentionInput）
- **Zustand + persist 中间件** · 游戏状态 + 运行时持久化
- **Tailwind CSS 4** · 自建设计 token
- **TypeScript**

## 项目结构

```
src/
├── app/               # 页面路由
│   ├── page.tsx          首页：API 配置 + 故事上传 + 存档列表
│   ├── setup/            介入方式、角色选择、时间节点、护栏设置
│   ├── play/             游戏主界面（叙事流 + @ 输入 + 选项）
│   ├── characters/       角色图鉴（桌面双栏 / 移动栈式）
│   ├── archive/          存档回顾（叙事回放 + 交互统计）
│   └── epilogue/         后日谈（流式生成 + 进度条 / 卡片浮现）
├── components/        # 共享组件
│   ├── NarrativeFeed     play / archive 的气泡叙事渲染（含流式 dialogue 气泡）
│   ├── MentionInput      @ 提及输入 + 浮层（contenteditable + atomic chip）
│   └── Icons             内联 SVG
├── lib/               # 核心逻辑
│   ├── llm-browser       OpenAI / Anthropic 浏览器端流式调用
│   ├── narrator-browser  叙事生成、流式 JSON 提取、系统咨询、转生生成、后日谈流式
│   ├── parser-client     增量图谱构建、哈希缓存、续传
│   ├── storage           localStorage 存档/故事/配置
│   └── types             核心类型
└── store/             # Zustand 状态 + persist 中间件
    └── gameStore
```

## 架构要点

### 流式 JSON 解析（叙事、对白、后日谈通用）
LLM 每次返回严格 JSON，但浏览器端要让 UI 边流边渲染，不能等整个 JSON 闭合。`narrator-browser.ts` 里有三个共享 helper：

- **`decodePartialJSONString(buffer, startIdx)`** — 字符级状态机，读一个 JSON 字符串字面量的内容（处理 `\n` / `\"` / `\uXXXX` 等转义，遇到未完成的转义序列就停下等下一 token）。用于从半完成的 JSON 里提取当前流到一半的字段值。
- **`tryParseBalancedObject(buffer, startIdx)`** — 扫描一对平衡的 `{...}`，考虑字符串内的 `"` 和反斜杠。平衡则交给 `JSON.parse`；不完整返回 null。
- **`extractStreamingState` / `extractStreamingEpilogue`** — 顶层扫描器，复用上面两个 helper 从流式 buffer 里抽出"已完成的条目 + 当前半成的条目"。叙事用来流式显示 narration 和 dialogues，后日谈用来流式显示每角色的 memoir。

这套机制让 UI 永远看到的是干净的散文/对白/回忆，从不看见 JSON 结构字符。

### 增量图谱 + 续传缓存
`parser-client.ts` 维护一个逐片增长的图谱 `Graph`，每片 LLM 调用都把当前图谱摘要注入 prompt：

```
已知角色：林宇（沉默寡言的少年剑客）、王公公（东厂太监）
已知地点：天牢、南宫府
已知世界观：明朝嘉靖 / 武侠 / ...
```

LLM 在 `updatedCharacters` 补充已知角色新信息、在 `newCharacters` 添加新角色。客户端合并时做 `appendDistinct` 拼接（不"取最长"丢信息），并按需修正 LLM 误分类。

每片完成后把整个图谱按 `sha256(fullText) + chunkIndex` 为 key 写入 `localStorage`。下次再跑：从最高命中点恢复图谱，从下一片继续——断点续传的粒度是"片"，语义是"无损"。

`PROMPT_VERSION` 常量纳入 cache key，prompt 调整时 bump 即作废旧缓存。

### 角色在场状态
`play/page.tsx` 每次 `narrativeHistory` 更新时 `useMemo` 重算最近 5 轮出现过的角色名集合。@ 候选列表据此实时分组（在场/不在场），排序始终是 **系统 → 在场 → 不在场**。

### Zustand 运行时持久化
`gameStore` 用 `persist` 中间件把运行时状态（parsedStory / playerConfig / narrativeHistory / characterInteractions / currentSaveId / isPlaying / 护栏参数）落到 `localStorage` key `ai-toktok-runtime`。

排除项：
- `llmConfig` / `saves` — 另有独立 storage key，避免重复
- `isParsing` / `isGenerating` — 瞬态 UI 旗标，`init()` 内清零

这样即使 static export 下某些跨段跳转退化为硬刷新，玩家也不会在 /play 或 /epilogue 落地时遇到"请先完成设置"的 fallback。

### 后日谈生成：边跳转边流
点击"结束故事"后不再阻塞 play 页。流程：

1. play 页 `handleEndStory` 只做 `router.push('/epilogue?generating=1')`
2. epilogue 页挂载时检查 query + 现有存档：无 epilogue 则触发 `generateEpilogueBrowser` 并把 `onProgress` 回调接到本地 state
3. UI 显示 determinate 进度条 + 每个完成的 memoir 作为 `MemoirCard` 淡入
4. 生成完成后 `completeGame(result)` 写入存档，`router.replace('/epilogue')` 去掉 query（防刷新重跑）

后日谈的 prompt 同时接收**按幕编号的完整叙事转写 + 每个参与角色的 personality + 结构化交互日志（含 sentiment 中文标签）**，明令禁止引用原作剧情，强制每段回忆至少出现 2-3 个可对应到叙事记录的具体细节。

## 部署

推到 `main` 分支后，GitHub Actions 自动构建并部署到 GitHub Pages。

- Workflow: `.github/workflows/deploy.yml`
- 发布地址: `https://<user>.github.io/ai-toktok/`
- `next.config.ts` 在 `GITHUB_ACTIONS=true` 环境下自动加 `/ai-toktok` 的 `basePath`，本地开发不受影响

## 浏览器兼容性

- Chromium 90+ · Firefox 90+ · Safari 16+（contenteditable chip、`env(safe-area-inset-*)`、流式 `fetch` / SSE 解析、Web Crypto `crypto.subtle.digest`）
- 移动端：iOS / Android Chromium 经过 viewport + 安全区适配
