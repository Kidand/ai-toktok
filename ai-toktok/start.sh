#!/bin/bash
# AI TokTok - 一键启动脚本

cd "$(dirname "$0")"

PORT=3000

# 检查端口
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "端口 $PORT 被占用，正在释放..."
  lsof -ti:$PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

# 检查后端 Python 环境
if [ ! -d "backend/.venv" ]; then
  echo "正在安装后端依赖..."
  cd backend && uv sync && cd ..
fi

# 检查是否需要 build 前端
if [ ! -d "out" ]; then
  echo "正在构建前端..."
  npm install && npx next build
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     AI TokTok - 沉浸式叙事沙盒      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  http://localhost:$PORT"
echo "  按 Ctrl+C 停止服务"
echo ""

cd backend
exec uv run uvicorn main:app --host 0.0.0.0 --port $PORT
