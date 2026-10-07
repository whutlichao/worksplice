#!/usr/bin/env bash
# Edge Instrumentation 警告的反馈回路（issue #101）。
#
# 用法：repro.sh <输出日志文件> [端口]
# 判定：stderr+stdout 落盘后统计 `not supported in the Edge Runtime` 的条数。
#   - 改动前必须 > 0（红）
#   - 改动后必须 = 0（绿）
#
# 为什么带端口参数：`npm run dev` 固定 -p 30142，而 main 上已有一个 dev server 占着
# 30142（coordinator 只读，不许抢）。`npm run dev -- -p <port>` 是同一条 npm 脚本、
# 命令行只多了端口覆盖，其余完全相同；红绿两遍用同一份命令，保证可比。
set -uo pipefail

LOG=${1:?用法: repro.sh <输出日志文件> [端口]}
PORT=${2:-30199}
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$REPO" || exit 1
rm -f "$LOG"
: >"$LOG"

# 干净起点：dev server 的编译期警告由本次启动产生，不复用上一次 .next/dev 的缓存输出。
rm -rf .next/dev 2>/dev/null

npm run dev -- -p "$PORT" >"$LOG" 2>&1 &
DEV_PID=$!

cleanup() {
  if kill -0 "$DEV_PID" 2>/dev/null; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
  # next dev 会 fork next-server，端口上可能还挂着残留
  local leftover
  leftover=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$leftover" ]; then kill $leftover 2>/dev/null; fi
}
trap cleanup EXIT

# 等服务真的起来（最长 120s）
READY=0
for _ in $(seq 1 240); do
  if grep -q "Ready in" "$LOG" 2>/dev/null; then READY=1; break; fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then break; fi
  sleep 0.5
done

HTTP=000
if [ "$READY" = 1 ]; then
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://127.0.0.1:$PORT/" || echo 000)
  # 再打一次静态资源，凑够「每个请求周期刷一遍」的观察窗
  curl -s -o /dev/null --max-time 30 "http://127.0.0.1:$PORT/api/sessions" || true
  sleep 3
fi

cleanup
trap - EXIT

COUNT=$(grep -c "not supported in the Edge Runtime" "$LOG" 2>/dev/null)
COUNT=${COUNT:-0}

echo "=============================================="
echo "port=$PORT  ready=$READY  http(GET /)=$HTTP"
echo "edge-warning-count=$COUNT"
echo "=============================================="
echo "--- 前 3 段原文 ---"
awk '/not supported in the Edge Runtime/{n++} n<=3' "$LOG" | head -60
echo "=============================================="

# 退出码：把「条数」也编码进去，便于脚本化判绿
[ "$HTTP" = "200" ] || exit 2
[ "$COUNT" -gt 0 ] && exit 1
exit 0
