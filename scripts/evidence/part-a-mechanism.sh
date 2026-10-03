#!/usr/bin/env bash
# 票 05 · 证据 A：freshness-hold 的机制证明（确定性、无模型、零成本）
#
# 它证明的不是"我们的 agent 很聪明"，而是**协议本身**：
#   写消息时可以声明"我是基于房间的哪个版本写的"（baseSeq）。
#   如果房间在那之后动过，写不会被合并、也不会覆盖——它被 **hold**，
#   并附带"期间发生了什么"（whatHappened）交回作者，由作者决定 revise/resend/silent/anyway。
#
# 用法： BASE=http://127.0.0.1:3105 OUT=<目录> bash part-a-mechanism.sh
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3105}"
OUT="${OUT:-/tmp/ws-evidence/artifacts}"
mkdir -p "$OUT"
SLOT="$OUT/.last-response.json"

# 用 node 生成 JSON，避免 shell 引号把正文里的标点吃掉
json_body() { # json_body <targetId> <content> [baseSeq]
  node -e 'const [t,c,b]=process.argv.slice(1);const o={targetId:t,content:c};if(b)o.baseSeq=Number(b);process.stdout.write(JSON.stringify(o))' "$1" "$2" "${3:-}"
}
post_message() { # post_message <targetId> <content> [baseSeq] -> 设置 $HTTP，正文写 SLOT
  HTTP=$(json_body "$1" "$2" "${3:-}" | curl -s -o "$SLOT" -w '%{http_code}' \
    -X POST "$BASE/api/messages" -H 'content-type: application/json' --data-binary @-)
}
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);console.log(v===undefined?'':v)})" "$1" < "$SLOT"; }
pretty() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))" < "$SLOT"; }

echo "### 1. 建一个干净频道（名字带时间戳，避免重名）"
CH_ID=$(node -e 'const [b,n]=process.argv.slice(1);process.stdout.write(JSON.stringify({name:n,description:"票 05 证据：并发写被 hold"}))' "$BASE" "evidence-hold-$(date +%H%M%S)" \
  | curl -s -X POST "$BASE/api/channels" -H 'content-type: application/json' --data-binary @- \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).channel.id))")
echo "channel = $CH_ID"
echo "$CH_ID" > "$OUT/part-a-channel-id.txt"

echo
echo "### 2. Alice 写下房间的第 N 版（并记下她读到的版本号）"
post_message "$CH_ID" "Alice：我来改 parser.js 里的 split 逻辑。"
cp "$SLOT" "$OUT/part-a-1.json"
SEQ1=$(field 'j.message.seq')
echo "HTTP $HTTP  → seq = $SEQ1（这就是 Alice 读到的房间版本）"

echo
echo "### 3. Alice 还在写的时候，房间动了：Bob 写下了新的一版"
post_message "$CH_ID" "Bob：等一下——按逗号切分会在引号内的逗号上出错，先别动手。"
cp "$SLOT" "$OUT/part-a-2.json"
SEQ2=$(field 'j.message.seq')
echo "HTTP $HTTP  → seq = $SEQ2（房间已经走到第 $SEQ2 版）"

echo
echo "### 4. Alice 基于旧版本（baseSeq=$SEQ1）提交 —— 预期：被 hold，而不是覆盖 Bob"
post_message "$CH_ID" "Alice：已按原计划改完 parser.js。" "$SEQ1"
cp "$SLOT" "$OUT/part-a-3-held.json"
echo "HTTP $HTTP （预期 409）"
pretty

echo
echo "### 5. 房间现状：Bob 的话还在，Alice 那一版没有被写进去"
curl -s "$BASE/api/channels/$CH_ID/messages?limit=10" > "$OUT/part-a-4-room.json"
node -e "
const j=require('$OUT/part-a-4-room.json');
const list=j.messages||j;
for (const m of list) console.log('  #'+m.seq+'  '+String(m.content).slice(0,64));
"

echo
echo "### 6. Alice 改用最新版本（baseSeq=$SEQ2）重发 —— 预期：201，写进去了"
post_message "$CH_ID" "Alice：收到。不动 split 了——改成引号感知的切分，并补一个用例。" "$SEQ2"
cp "$SLOT" "$OUT/part-a-5-revised.json"
echo "HTTP $HTTP （预期 201）"

echo
echo "### 证据落盘于 $OUT"
ls -1 "$OUT" | grep -v '^\.'