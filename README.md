# AI TokTok

沉浸式 IP 互动叙事沙盒。上传一段故事文本，AI 会把它解析成可探索的世界（角色、地点、时间线），你选择"魂穿"已有角色或让 AI 生成一个转生身份介入其中，与世界实时交互并产生你独有的分支剧情。

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
- 解析器按段落切片，串行喂给 LLM，每一片的 prompt 都带上前序片累积出的"已知角色/地点/世界观"，引导模型复用主名、消解别名（"林公子 → 林宇"、"他/那人"指代）
- 每片处理完快照落盘（按**全文哈希 + 片号**做 key），失败重试会自动从最高成功点**续传**，不会白跑
- 片内流式显示进度；每片独立重试 3 次指数退避
- 全部解析完走一次小型 LLM "润色"，生成统一的标题、梗概、基调、时间线

### 介入方式
- **魂穿**：扮演故事中的既有角色
- **转生**：AI 按世界观生成一个全新原创角色让你代入
- 可选择从任意关键事件节点切入故事

### 互动游玩
- 聊天气泡式的叙事流，玩家独白/角色对白/系统事件样式分明
- **流式渲染只显示叙事散文**——LLM 输出的 JSON 结构字符被实时过滤掉（JSON 感知状态机解析 `narration` 字段边流边显）
- 每轮结束推送 2-3 个"具体行动"选项；选项按钮点选等价于打字输入，不会陷入"点几次才推进一点"的循环
- 双变量护栏：温度、严谨度、叙事/对话比重，实时调节 LLM 行为

### @ 提及系统（类 Claude Code）
输入 `@` 弹出候选面板：
- **系统**（◎ 总在第一位）：咨询提示、澄清规则、提示可做什么；回应**不进入剧情历史**、不推进故事，像"小声耳语"
- **在场角色**（绿点）：最近 5 轮叙事里出现过的角色，可 @ 与之互动
- **不在场角色**（灰点）：曾出现但当前已离场，列在末尾，**不可选择**
- 候选项随故事进展实时变化
- 系统与角色同回合**互斥**，避免意图歧义
- Mention 以原子 chip 形式占位，点 × 或键盘 Backspace 可删

### 档案与结局
- 自动存档到 `localStorage`
- 回顾模式：按时间轴重放整段故事 + 角色好感统计可视化
- 结束故事后生成"后日谈"：每位核心角色以自己的语气写下对玩家的回忆

## 技术栈

- **Next.js 16** (App Router, static export to GitHub Pages)
- **React 19** (含 contenteditable 的 MentionInput)
- **Zustand** · 游戏状态
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
│   └── epilogue/         后日谈（角色回忆卡片）
├── components/        # 共享组件
│   ├── NarrativeFeed     play / archive 的气泡叙事渲染
│   ├── MentionInput      @ 提及输入 + 浮层（contenteditable）
│   └── Icons             内联 SVG
├── lib/               # 核心逻辑
│   ├── llm-browser       OpenAI / Anthropic 浏览器端流式调用
│   ├── narrator-browser  叙事生成、流式 JSON 提取、系统咨询、转生生成、后日谈
│   ├── parser-client     增量图谱构建、哈希缓存、续传
│   ├── storage           localStorage 存档/故事/配置
│   └── types             核心类型
└── store/             # Zustand 状态
    └── gameStore
```

## 架构要点

### 流式叙事渲染
LLM 被要求输出 `{"narration": "...", "dialogues": [...], "choices": [...], "interactions": [...]}` 的 JSON。朴素流式会把结构字符暴露给用户，体验差。

`narrator-browser.ts` 的 `extractStreamingNarration` 是一个小型 JSON 感知状态机：从累积 buffer 中定位 `"narration"` 键，按字符级读取其字符串值（处理 `\n` / `\"` / `\uXXXX` 等转义），边流边输出纯粹的叙事散文。对话、选项、交互记录则等 JSON 完整后批量呈现。

### 增量解析 + 续传缓存
`parser-client.ts` 维护一个逐片增长的图谱 `Graph`，每片 LLM 调用都把当前图谱摘要注入 prompt：

```
已知角色：林宇（沉默寡言的少年剑客）、王公公（东厂太监）
已知地点：天牢、南宫府
已知世界观：明朝嘉靖 / 武侠 / ...
```

LLM 在 `updatedCharacters` 补充已知角色新信息、在 `newCharacters` 添加新角色。客户端合并时做 `appendDistinct` 拼接（不"取最长"丢信息），并按需修正 LLM 误分类。

每片完成后把整个图谱按 `sha256(fullText) + chunkIndex` 为 key 写入 `localStorage`。下次再跑：从最高命中点恢复图谱，从下一片继续——断点续传的粒度是"片"，语义是"无损"。

### 角色在场状态
`play/page.tsx` 每次 `narrativeHistory` 更新时 `useMemo` 重算最近 5 轮出现过的角色名集合。@候选列表据此实时分组（在场/不在场），排序始终是 **系统 → 在场 → 不在场**。

## 部署

推到 `main` 分支后，GitHub Actions 自动构建并部署到 GitHub Pages。

- Workflow: `.github/workflows/deploy.yml`
- 发布地址: `https://<user>.github.io/ai-toktok/`
- `next.config.ts` 在 `GITHUB_ACTIONS=true` 环境下自动加 `/ai-toktok` 的 `basePath`，本地开发不受影响

## 浏览器兼容性

- Chromium 90+ · Firefox 90+ · Safari 16+（contenteditable chip、`env(safe-area-inset-*)`、流式 `fetch` / SSE 解析）
- 移动端：iOS / Android Chromium 经过 viewport + 安全区适配
