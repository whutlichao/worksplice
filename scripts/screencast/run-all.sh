#!/usr/bin/env bash
# 90 秒介绍视频 · 一键重跑：清洗数据 → seed → 构建 → 起服务 → 捕获 → 合成 → 校验。
#
# 用法：bash scripts/screencast/run-all.sh
# 覆盖：DATA_DIR / OUT / PORT / BASE / TAG（见下）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"

DATA_DIR="${DATA_DIR:-/tmp/screencast-90s-v2/demo-data}"
# 默认落在 /tmp：仓库 .scratch/ 只有 promote-worksplice/ 被忽略，成品不该进 git status。
OUT="${OUT:-/tmp/screencast-90s-v2/out}"
PORT="${PORT:-30153}"
BASE="${BASE:-http://127.0.0.1:$PORT}"
TAG="${TAG:-$(date +%m%d%H)}"

mkdir -p "$(dirname "$OUT")"
echo "== 数据目录 ${DATA_DIR}（输出 ${OUT}）"
rm -rf "$DATA_DIR"
WORKSPLICE_DATA_DIR="$DATA_DIR" node scripts/seed-demo.mjs

echo "== 生产构建"
[ -d node_modules ] || bun install
npm run build

echo "== 起服务（端口 ${PORT}，数据目录独立）"
WORKSPLICE_DATA_DIR="$DATA_DIR" npx next start -H 127.0.0.1 -p "$PORT" >"$OUT.server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -s -o /dev/null "$BASE/" && break
  sleep 1
done
curl -s -o /dev/null "$BASE/" || { echo "服务未起来，见 $OUT.server.log" >&2; exit 1; }

echo "== 捕获（逐帧渲染，约 2700 帧）"
rm -rf "$OUT"
WORKSPLICE_DATA_DIR="$DATA_DIR" BASE="$BASE" OUT="$OUT" TAG="$TAG" \
  node scripts/screencast/capture.mjs

echo "== 合成"
OUT="$OUT" bash scripts/screencast/compose.sh

echo "== 完成：$OUT/worksplice-90s.mp4"
