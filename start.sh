#!/bin/bash
# In The Book - 本地一键启动

set -e
cd "$(dirname "$0")"

PORT=3000

if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   In The Book - 沉浸式叙事沙盒       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  http://localhost:$PORT"
echo "  按 Ctrl+C 停止服务"
echo ""

exec npx next dev -p $PORT
