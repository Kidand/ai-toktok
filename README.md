# AI TokTok

沉浸式 IP 互动叙事沙盒。上传一段故事文本（或直接选一个预设），AI 会把它解析成可探索的世界（角色、地点、时间线），你选择"魂穿"已有角色或让 AI 生成一个转生身份介入其中，与世界实时交互并产生你独有的分支剧情。故事结束后，每个与你交集过的角色会以自己的语气写下对你的回忆。

纯客户端应用 — 浏览器直接调用 OpenAI / Anthropic API（或任何兼容接口），无后端、无账号系统。

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

## 视觉与交互风格

当前 UI 是**新野兽派（neo-brutalist）** 风格：米色纸张质地背景 + 实心黑色厚边框 + 硬位移投影（无模糊），全局用三种字体声音——衬线中文做散文、Space Grotesk 做 UI、JetBrains Mono 做状态与玩家输入。

- 每一次叙事都标号 `T01`、`T02`…；设置页分章 `Ch.01 / 02 / 03 / 04`；事件标 `E01`
- 对白回归**脚本记录体**：说话者是一个彩色标签，内容在线框里（每个 NPC 按名字哈希分配固定色）
- 玩家输入显示为**终端式 banner**：等宽字 + 荧光黄底 + `▸` 前缀，视觉上区分"你"与"世界"
- 按钮有厚边 + 硬阴影；按下时阴影归零，按钮被"按"下去
- 保留原 UI：tag `ui-literary` 指向重做前那一版暗色文学风，`git checkout ui-literary` 可回看

## 功能概览

### 预设故事（新）
首页默认显示**预设故事**标签。管理员可以提前把任意文本加工成 `ParsedStory` 固化到仓库里，用户一键进入无需自己上传解析。

- 当前内置一个预设（`绝命毒师`）作为 demo
- 点击预设卡片 → 校验 API 密钥已填 → 直接跳 `/setup` 选角色/事件
- 每个预设的 `id`、角色 id、地点 id、事件 id 都是**稳定 slug**（`preset:…` / `char:c01` / `loc:l01` / `event:e01`），保证跨会话身份一致、存档能正确回读
- 预设本身已是一份完整 `ParsedStory`，走不走 LLM 解析由有没有现成 preset 决定——预设不吃你的 parser token 配额
- 如何添加：见下方"管理员脚本"

### 故事解析 · 增量图谱构建（自上传路径）
- 上传任意长度的 `.txt` / `.md` 故事文本
- 解析器按段落切片，串行喂给 LLM。每一片的 prompt 都带上前序片累积出的"已知角色/地点/世界观"，引导模型复用主名、消解别名（"林公子 → 林宇"、"他/那人"指代）
- **片内流式渲染进度**：每片的 LLM 调用用 `streamLLMBrowser` 边接收边推进进度条，按字符数估算，不会卡在 5% 干等
- **续传快照**：每片处理完后快照落盘（按 `sha256(fullText) + chunkIndex` 做 key）。失败重试自动从最高成功点续传——中断过的长故事不会白跑
- 每片独立重试 3 次（500ms / 2s / 5s 指数退避）
- 全部解析完走一次小型 LLM 润色，生成统一的标题、梗概、基调、时间线
- 对第一人称视角主角特别处理：即使主角只被"我/他/她"代称也强制纳入角色列表（魂穿模式才能选到）

### 介入方式
- **魂穿**：扮演故事中的既有角色
- **转生**：AI 按世界观生成一个全新原创角色让你代入
- 可选择从任意关键事件节点切入故事
- 双变量护栏 + 叙事/对话比重：温度、严谨度、narrative weight 实时调节 LLM 行为

### 互动游玩
- **脚本体叙事流**：每次叙事前有一条 `── T03 ────────` 分幕线；narration 以中文衬线散文呈现；NPC 对白是一个彩色**说话者标签**挂在厚边线框内容块上方；玩家动作渲染为等宽字 + 荧光黄 banner，前缀 `▸`，像终端命令
- **多层次流式渲染**：
  - `narration` 字段边流边显示为散文段落（JSON 结构字符被实时过滤，思考型模型的 `<think>…</think>` 也会被剥掉）
  - `dialogues` 数组里的每一句对白**一条条浮现**——闭合一条出一条，最后一条未闭合的带打字光标实时写作
- **选项推进**：每轮 2-3 个"具体行动"选项；选项按钮和自由输入走相同的推进路径（prompt 明令禁止"继续观察"这类原地打转的选项）。关键分支点（`isBranchPoint: true`）的选项会 pulse-flag 提示"这步重要"
- **剧情推进规则**：系统 prompt 强制每回合必须有实质事件发生，禁止换措辞复述同一场景

### @ 提及系统（类 Claude Code）
输入 `@` 弹出候选面板：
- **系统**（✦ 总在第一位）：咨询提示、澄清规则、提示可做什么；回应**不进入剧情历史**、不推进故事、不触发自动存档，像"小声耳语"
- **在场角色**（绿点）：最近 5 轮叙事里出现过的角色，可 @ 与之互动
- **不在场角色**（灰点）：曾出现但当前已离场，列在末尾，**不可选择**（键盘跳过、点击无效、陪衬标"不在场"）
- 候选项随故事进展实时变化
- **系统与角色同回合互斥**：一旦 @ 了其中一类，另一类自动灰掉，避免意图歧义
- Mention 以原子 chip 形式占位，点 × 或键盘 Backspace 可删

### 档案与结局
- **运行时状态持久化**：Zustand 中间件把游戏中的 parsedStory / playerConfig / narrativeHistory 等落到 `localStorage`，页面刷新或路由切换不丢状态
- **自动存档**：每次叙事完成后写入存档
- **回顾模式**：按时间轴重放整段故事 + 角色好感统计（正面/中立/负面 stack 进度条）
- **后日谈流式生成**：点击"结束故事"立即跳转到 `/epilogue` 页面，生成过程在这里进行——
  - 顶部 determinate 进度条（`已完成 N / 总数 M`）
  - 每位角色的回忆**一张张浮现**（LLM 返回的 JSON 数组用 partial-JSON 解析器边流边解）
  - 最后一位回忆的卡片带打字光标实时写作
  - 回忆基于**本次游玩的完整叙事记录 + 角色 personality + 情感轨迹**生成，不是原作剧情的改写

### 推理模型兼容
支持 DeepSeek-R1 / MiniMax-M 系列 / Qwen/GLM 推理版 等会把 `<think>…</think>` 塞进 `content` 的模型：

- 传输层只消费 OpenAI 的 `delta.content` 和 Anthropic 的 `delta.text`，自动过滤 `reasoning_content` / `thinking_delta`
- 内容层用 `stripThinking(buffer)` 在所有消费点剥掉完整/半开的 `<think>` 标签块
- JSON 抽取层用 `extractFirstBalancedJSON(buffer)` 兜底：模型在 JSON 前后夹杂解释文字也能解得出来

## 管理员脚本：把任意文本转成预设故事

**脚本路径**：`scripts/build-preset.ts`

**为什么是脚本**：预设故事是固化在仓库里的静态资产，用户访问时直接加载编译好的 JS。脚本只在管理员本地跑一次，产出一份 TS 文件 → commit & push → 线上生效。脚本本身**不会被打进前端 bundle**，永远不会在浏览器执行，API key 也只来自本地环境变量。

**用法**：

```bash
# 用 OpenAI 官方接口
OPENAI_API_KEY=sk-xxx npm run build-preset -- \
  --input ./path/to/story.txt \
  --slug three-body \
  --title "三体" \
  --tagline "三颗恒星下的文明" \
  --chips "近未来,硬科幻,哲学"

# 用自建/兼容接口（DeepSeek、MiniMax、OpenRouter、本地 Ollama 等）
OPENAI_API_KEY=sk-xxx npm run build-preset -- \
  --input ./story.txt --slug my-tale --title "我的故事" \
  --provider openai \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-chat

# 用 Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx npm run build-preset -- \
  --input ./story.txt --slug my-tale --title "我的故事" \
  --provider anthropic --model claude-sonnet-4-20250514
```

**脚本做了什么**：

1. 读取 `--input` 指向的本地文本
2. 跑项目**自身**的 `parseStoryClient`：同样的增量图谱构建 + 哈希缓存（Node 无 localStorage 时自动降级为无缓存）+ 重试 + 润色，质量与用户在浏览器里上传一致
3. 把返回 `ParsedStory` 里的 UUID 重写为稳定 slug：`preset:<slug>` / `char:c01` / `loc:l01` / `event:e01`，所有交叉引用（relationships / involvedCharacterIds / locationId）同步更新
4. 在每个 character / location / event 上方插入 `// <原名>` 注释，方便人工复审
5. `originalText` 作为 template literal 安全编码（` `` ` 和 `${…}` 已转义）
6. 默认写到 `src/lib/presets/<slug>.ts`（可用 `--out` 覆盖到任意相对路径）
7. 终端输出**可直接粘贴**的 `PRESETS` 注册代码片段；脚本不会自动改 `src/lib/presets/index.ts`，留一次人工 review 机会

**执行反馈**：stderr 上一条实时刷新的进度行——`切片中 → 第 3.47/9 段 · 已识别 12 角色 · 续传@2 · 重试#1 → 润色 → 构建`。跑完打印最终统计（`N 角色 · M 地点 · K 事件`）。

**所有参数**：

```
--input <path>    必填，本地故事文件（相对或绝对路径）
--slug <slug>     必填，预设标识，决定 id 和默认输出路径
--title <text>    必填，UI 上显示的标题
--out <path>      可选，输出路径，默认 src/lib/presets/<slug>.ts
--tagline <text>  可选，一行简介（仅作为注释写进输出文件）
--chips "a,b,c"   可选，genre/era chips（仅作为注释）
--provider <p>    可选，openai | anthropic，默认 openai
--model <name>    可选，默认 gpt-4o / claude-sonnet-4-20250514
--base-url <url>  可选，自建或兼容接口
--api-key <key>   可选，优先于环境变量
--help            打印帮助并退出
```

**添加新预设的完整流程**：

1. `npm run build-preset -- --input ./foo.txt --slug foo --title "标题"`
2. 查看生成的 `src/lib/presets/foo.ts`，必要时手工调整
3. 按终端提示，在 `src/lib/presets/index.ts` 的 `PRESETS` 数组里增加一条
4. `git add src/lib/presets/foo.ts src/lib/presets/index.ts`
5. `git commit -m "feat(presets): add foo preset"`
6. `git push` — Pages workflow 自动部署

## 技术栈

- **Next.js 16**（App Router, static export to GitHub Pages）
- **React 19**（contenteditable MentionInput）
- **Zustand + persist 中间件** · 游戏状态 + 运行时持久化
- **Tailwind CSS 4** · 自建设计 token
- **TypeScript**
- **tsx**（devDep 唯一新增，给 `scripts/` 跑 TS 用）

## 项目结构

```
.
├── scripts/
│   └── build-preset.ts    # 管理员工具：文本 → 预设故事 TS 模块
├── src/
│   ├── app/               # 页面路由
│   │   ├── page.tsx          首页：预设 / 新故事 / 存档 三 tab
│   │   ├── setup/            介入方式、角色选择、时间节点、护栏设置
│   │   ├── play/             游戏主界面（叙事流 + @ 输入 + 选项）
│   │   ├── characters/       角色图鉴（桌面双栏 / 移动栈式）
│   │   ├── archive/          存档回顾（叙事回放 + 交互统计）
│   │   └── epilogue/         后日谈（流式生成 + 进度条 / 卡片浮现）
│   ├── components/        # 共享组件
│   │   ├── NarrativeFeed     play / archive 的脚本体叙事渲染（含流式 dialogue）
│   │   ├── MentionInput      @ 提及输入 + 浮层（contenteditable + atomic chip）
│   │   └── Icons             内联 SVG
│   ├── lib/               # 核心逻辑
│   │   ├── llm-browser       OpenAI / Anthropic 流式调用（浏览器 + Node 通用）
│   │   ├── narrator-browser  叙事生成、流式 JSON 提取、系统咨询、转生生成、后日谈流式、思考内容过滤
│   │   ├── parser-client     增量图谱构建、哈希缓存、续传
│   │   ├── presets/          内置预设故事
│   │   │   ├── index.ts        PRESETS 数组 + Preset 类型
│   │   │   └── breaking-bad.ts 预设示例（绝命毒师）
│   │   ├── storage           localStorage 存档/故事/配置
│   │   └── types             核心类型
│   └── store/             # Zustand 状态 + persist 中间件
│       └── gameStore
└── .github/workflows/deploy.yml
```

## 架构要点

### 流式 JSON 解析（叙事、对白、后日谈、推理模型兼容）
LLM 每次返回严格 JSON，但浏览器端要让 UI 边流边渲染，不能等整个 JSON 闭合。`narrator-browser.ts` 里有几个共享 helper：

- **`stripThinking(buffer)`** — 从 buffer 中剥掉完整 / 未闭合尾部的 `<think>…</think>` 块，兼容推理模型
- **`extractFirstBalancedJSON(buffer)`** — 跳过 JSON 前后杂文，扫出第一个平衡的 `{…}` 或 `[…]`，考虑字符串字面量和转义
- **`decodePartialJSONString(buffer, startIdx)`** — 字符级状态机，读一个 JSON 字符串字面量的内容（处理 `\n` / `\"` / `\uXXXX` 等转义，遇到未完成的转义序列就停下等下一 token）
- **`tryParseBalancedObject(buffer, startIdx)`** — 扫描一对平衡的 `{...}`，对流式 buffer 里的完整对象 `JSON.parse`；不完整返回 null
- **`extractStreamingState` / `extractStreamingEpilogue`** — 顶层扫描器，复用上面几个 helper 从流式 buffer 里抽出"已完成的条目 + 当前半成的条目"

这套机制让 UI 永远看到的是干净的散文/对白/回忆，从不看见 JSON 结构字符或思考过程。

### 增量图谱 + 续传缓存
`parser-client.ts` 维护一个逐片增长的图谱 `Graph`，每片 LLM 调用都把当前图谱摘要注入 prompt：

```
已知角色：林宇（沉默寡言的少年剑客）、王公公（东厂太监）
已知地点：天牢、南宫府
已知世界观：明朝嘉靖 / 武侠 / ...
```

LLM 在 `updatedCharacters` 补充已知角色新信息、在 `newCharacters` 添加新角色。客户端合并时做 `appendDistinct` 拼接（不"取最长"丢信息），并按需修正 LLM 误分类。

每片完成后把整个图谱按 `sha256(fullText) + chunkIndex` 为 key 写入 `localStorage`（Node 环境下自动降级为无缓存）。下次再跑：从最高命中点恢复图谱，从下一片继续——断点续传的粒度是"片"，语义是"无损"。

`PROMPT_VERSION` 常量纳入 cache key，prompt 调整时 bump 即作废旧缓存。

### 角色在场状态
`play/page.tsx` 每次 `narrativeHistory` 更新时 `useMemo` 重算最近 5 轮出现过的角色名集合。@ 候选列表据此实时分组（在场/不在场），排序始终是 **系统 → 在场 → 不在场**。

### 说话者稳定色
`NarrativeFeed.tsx` 的 `speakerColor(name)` 对每个非玩家角色做名字哈希，映射到固定 7 色（珊瑚/青/薄荷/紫丁香/橙/粉/天蓝，黄色保留给 CTA 和玩家）。同一角色整场游玩保持同一颜色，读者自然建立"林宇 = 珊瑚色"的视觉锚点。

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
- 管理员脚本：Node.js 20+（需要 global `fetch`、`crypto.subtle`、Web Streams）

## UI 版本切换

如果你想在 brutalist 和原先的"文学夜"版本之间切换：

```bash
# 回看原版
git checkout ui-literary

# 回到最新 brutalist
git checkout main
```

`ui-literary` 标签指向重做前最后一次 commit（`3f98082`）。
