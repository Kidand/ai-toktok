# AI TokTok

沉浸式 IP 互动叙事沙盒。纯客户端应用 — 浏览器直接调用 OpenAI / Anthropic API，无需后端。

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

> API 密钥在页面的「设置」里填入，保存在浏览器 `localStorage`，不会发到任何服务器。

## 技术栈

- Next.js 16 (App Router, static export)
- React 19
- Zustand (状态管理)
- Tailwind CSS 4
- TypeScript

## 项目结构

```
src/
├── app/          页面路由 (setup / play / characters / archive / epilogue)
├── lib/          核心逻辑 (llm-browser, narrator, parser, storage, types)
└── store/        Zustand 游戏状态
```

## 部署

推到 `main` 分支后，GitHub Actions 自动构建并部署到 GitHub Pages。

- Workflow: `.github/workflows/deploy.yml`
- 发布地址: `https://<user>.github.io/ai-toktok/`
- `next.config.ts` 会在 CI 环境下自动加上 `/ai-toktok` 的 `basePath`，本地开发不受影响。
