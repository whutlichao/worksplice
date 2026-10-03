#!/usr/bin/env bash
# 票 05 · 证据 B：真实运行 —— 一个 pi agent 的写被 hold，它改稿而不是覆盖
#
# 与证据 A 的区别：A 证明协议，B 证明**真跑起来时协议确实会触发**，
# 且 agent 选择了 revise（重读、重写），而不是覆盖别人刚说的话。
#
# 三次失败换来的两个前提（都不是"运气"）：
#   1) 必须等 agent **真正 drain 完**再插话——判据是它 session 里出现
#      [worksplice:target=<频道> seq=N] 标记，N 就是它读到的房间版本。
#      早了（会话还没起）两条消息会被同一轮一起读到，根本不会 hold。
#   2) 必须等它**先静默下来**再开始（新建 agent/频道会在 #all 触发别的轮次），
#      并且让插话**不唤醒她**（静音该频道；静音只挡唤醒，不挡 hold，
#      getSince 也不受静音过滤，所以 revise 仍能看到新消息正文）。
#      否则 revise prompt 会撞上一个正忙的会话，拿到空文本 →
#      round_logs 记 error（"revised reply had no content"），消息保持 pending 重试。
#
# 用法： BASE=... OUT=... PROJECT=... WORKSPLICE_DATA_DIR=... PI_CODING_AGENT_DIR=... MUTE=1 bash part-b-real-run.sh
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3105}"
OUT="${OUT:-/tmp/ws-evidence/artifacts}"
PROJECT="${PROJECT:-/tmp/ws-evidence/project}"
DATA="${WORKSPLICE_DATA_DIR:?需要 WORKSPLICE_DATA_DIR}"
MODEL_PROVIDER="${MODEL_PROVIDER:-new-api}"
MODEL_ID="${MODEL_ID:-space-bunny-free}"
THINKING="${THINKING:-low}"
MAX_INTERJECTIONS="${MAX_INTERJECTIONS:-3}"
QUIET_SECONDS="${QUIET_SECONDS:-10}"
INTERJECT_DELAY_SECONDS="${INTERJECT_DELAY_SECONDS:-0}"   # 录演示时给"仅唤醒"状态留出可见窗口
TAG="$(date +%H%M%S)"
# 文案可覆盖：默认中文（与 docs/design-notes 里引用的原文一致）；
# 要录英文演示时传 ASK_TEXT/INTERJECT_TEXT 的英文版本即可。
ASK_TEXT="${ASK_TEXT:-@Alice-$TAG 读一下 parser.js 和 README.md，然后**只回复**你打算怎么改 split。先别动代码，也不要创建/认领/更新任何任务。如果房间在你写作期间变了，请按 revise 重读重写（不要用 anyway 绕过）。}"
# shellcheck disable=SC2016
INTERJECT_TEXT="${INTERJECT_TEXT:-等一下——按逗号切分在引号里的逗号上会出错。先说方案，别直接改。}"
# 英文版（录演示用）：PROMPT_LANG=en 切过去，agent 名与 TAG 由脚本自己展开。
# shellcheck disable=SC2016
ASK_TEXT_EN="${ASK_TEXT_EN:-@Alice-$TAG read parser.js and README.md, then **reply only** with how you would change split. Do not touch code yet, and do not create, claim, or update any task. If the room changes while you are writing, revise: re-read and rewrite (do not bypass with anyway).}"
# shellcheck disable=SC2016
INTERJECT_TEXT_EN="${INTERJECT_TEXT_EN:-Hold on — splitting on commas breaks on commas inside quotes. Lay out the approach first; do not edit the code.}"
if [ "${PROMPT_LANG:-zh}" = "en" ]; then ASK_TEXT="$ASK_TEXT_EN"; INTERJECT_TEXT="$INTERJECT_TEXT_EN"; fi
CHANNEL_DESC="${CHANNEL_DESC:-票 05 证据 B：真实运行}"
if [ "${PROMPT_LANG:-zh}" = "en" ]; then CHANNEL_DESC="Evidence B: a real run — a held write that gets revised"; fi
mkdir -p "$OUT"
SLOT="$OUT/.last.json"

post_json() { node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))' "$2" \
  | curl -s -o "$SLOT" -w '%{http_code}' -X POST "$BASE$1" -H 'content-type: application/json' --data-binary @- ; }
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);console.log(v===undefined?'':v)})" "$1" < "$SLOT"; }
q() { node -e "
  const D=require('better-sqlite3');const db=new D('$DATA/worksplice.db',{readonly:true});
  console.log(eval(process.argv[1]));
" "$1"; }
marks() { node -e "
  const fs=require('fs');
  if(!fs.existsSync(process.argv[1])){console.log('0 0 0');process.exit(0)}
  const lines=fs.readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  let n=0,lastSeq='',rev=0;
  for (const l of lines) {
    if (l.includes('worksplice:revision')) rev++;
    if (l.includes('worksplice:target='+process.argv[2])) {
      const m=l.match(/worksplice:target=[^\s]+ seq=(\d+)/); if (m) { n++; lastSeq=m[1]; }
    }
  }
  console.log(n+' '+(lastSeq||0)+' '+rev);
" "$1" "$2"; }

echo "### 1. 建 agent Alice-$TAG（$MODEL_PROVIDER/$MODEL_ID，thinking=$THINKING）"
JSON=$(post_json /api/members "{\"name\":\"Alice-$TAG\",\"description\":\"改 parser.js 的 agent\",\"provider\":\"$MODEL_PROVIDER\",\"modelId\":\"$MODEL_ID\",\"thinkingLevel\":\"$THINKING\"}")
ALICE=$(field 'j.agent.id'); echo "$ALICE" > "$OUT/part-b-alice-id.txt"; echo "HTTP $JSON → alice = $ALICE"

echo
echo "### 2. 绑到项目目录"
JSON=$(post_json "/api/members/$ALICE/workspace" "{\"workspacePath\":\"$PROJECT\"}")
echo "HTTP $JSON → $(field 'j.agent.workspace_path')"

echo
echo "### 3. 建频道并把 Alice 放进去"
CH_JSON=$(node -e 'process.stdout.write(JSON.stringify({name: "hold-run-" + process.argv[1], description: process.argv[2], memberIds: [process.argv[3]]}))' "$TAG" "$CHANNEL_DESC" "$ALICE")
JSON=$(post_json /api/channels "$CH_JSON")
CH=$(field 'j.channel.id'); echo "$CH" > "$OUT/part-b-channel-id.txt"; echo "HTTP $JSON → channel = $CH"

echo
echo "### 4. 等她先静默下来（建号/建频道会在 #all 触发别的轮次，它们会抢会话）"
last=-1; same=0; i=0
while [ $i -lt 240 ]; do
  n=$(q "db.prepare('SELECT COUNT(*) c FROM round_logs WHERE agent_id=?').get('$ALICE').c")
  st=$(q "db.prepare('SELECT status FROM members WHERE id=?').get('$ALICE').status")
  if [ "$n" = "$last" ] && [ "$st" != "working" ]; then same=$((same+1)); else same=0; fi
  last=$n
  if [ $same -ge $((QUIET_SECONDS*2)) ]; then echo "  → 已静默 ${QUIET_SECONDS}s（累计轮次=$n，状态=$st）"; break; fi
  sleep 0.5; i=$((i+1))
done

echo
echo "### 5. Bob 唤醒 Alice"
ASK_JSON=$(node -e 'process.stdout.write(JSON.stringify({targetId: process.argv[1], content: process.argv[2]}))' "$CH" "$ASK_TEXT")
JSON=$(post_json /api/messages "$ASK_JSON")
echo "HTTP $JSON → seq = $(field 'j.message.seq')"

echo
echo "### 6. 等她 drain 完（拿到她读到的房间版本 N），让插话不唤醒她，然后插话"
SESS=""; DRAINS=0; N=0; REV=0; INTER=0
for i in $(seq 1 600); do
  [ -z "$SESS" ] && SESS=$(q "const r=db.prepare('SELECT pi_session_file FROM members WHERE id=?').get('$ALICE'); r&&r.pi_session_file||''")
  if [ -n "$SESS" ]; then read -r DRAINS N REV <<<"$(marks "$SESS" "$CH")"; echo "$SESS" > "$OUT/part-b-session-path.txt"; fi
  if [ "${REV:-0}" -gt 0 ]; then echo "  ✓ [worksplice:revision] 出现了（第 $i 次探测）"; break; fi
  if [ "${DRAINS:-0}" -gt "$INTER" ] && [ "$INTER" -lt "$MAX_INTERJECTIONS" ]; then
    INTER=$((INTER+1))
    if [ "${MUTE:-0}" = "1" ] && [ "$INTER" -eq 1 ]; then
      JSON=$(post_json "/api/channels/$CH/mute" "{\"memberId\":\"$ALICE\",\"muted\":true}")
      echo "  · 对照变量：静音该频道，让插话不唤醒她（HTTP $JSON）"
    fi
    echo "  → 第 $INTER 次插话：她 drain 到 N=$N，房间随即走到 $((N+1))"
    if [ "$INTER" -eq 1 ] && [ "${INTERJECT_DELAY_SECONDS}" -gt 0 ]; then
      echo "     （按 INTERJECT_DELAY_SECONDS=${INTERJECT_DELAY_SECONDS}s 延迟插话，让"仅唤醒"状态可见）"
      sleep "$INTERJECT_DELAY_SECONDS"
    fi
    INT_JSON=$(node -e 'process.stdout.write(JSON.stringify({targetId: process.argv[1], content: process.argv[2]}))' "$CH" "$INTERJECT_TEXT")
    JSON=$(post_json /api/messages "$INT_JSON")
    echo "     HTTP $JSON"
  fi
  sleep 0.5
done
[ "${REV:-0}" -gt 0 ] || echo "  ✗ 未触发 revise（drains=$DRAINS，插话=$INTER）"

echo
echo "### 7. 房间现状"
node -e "
const D=require('better-sqlite3');const db=new D('$DATA/worksplice.db',{readonly:true});
for (const m of db.prepare('SELECT seq,author_id,content FROM messages WHERE target_id=? ORDER BY seq').all('$CH')) {
  const who = m.author_id==='owner' ? 'Bob  ' : (m.author_id==='$ALICE' ? 'Alice' : 'Susan');
  console.log('  #'+m.seq+' '+who+'  '+String(m.content).replace(/\s+/g,' ').slice(0,150));
}
"
[ "${MUTE:-0}" = "1" ] && { post_json "/api/channels/$CH/mute" "{\"memberId\":\"$ALICE\",\"muted\":false}" >/dev/null || true; echo "  （已解除静音）"; }

echo
echo "### 8. round_logs"
node -e "
const D=require('better-sqlite3');const db=new D('$DATA/worksplice.db',{readonly:true});
for (const r of db.prepare('SELECT status,reason,base_seq,created_at FROM round_logs WHERE agent_id=? ORDER BY id').all('$ALICE'))
  console.log('  status='+r.status+'  reason='+JSON.stringify(r.reason)+'  base_seq='+r.base_seq+'  '+r.created_at);
"

echo
echo "### 9. 把 session 与 revise prompt 存成证据"
if [ -n "$SESS" ] && [ -f "$SESS" ]; then
  cp "$SESS" "$OUT/part-b-session.jsonl"
  node -e "
    const fs=require('fs');
    const lines=fs.readFileSync('$OUT/part-b-session.jsonl','utf8').split('\n').filter(Boolean);
    const rev=lines.filter(l=>l.includes('[worksplice:revision]'));
    console.log('  条目总数:', lines.length, '| revise 轮:', rev.length);
    if (rev.length) {
      const j=JSON.parse(rev[rev.length-1]);
      const txt=(j.message.content||[]).map(c=>c.text||'').join('\n');
      fs.writeFileSync('$OUT/part-b-revision-prompt.txt', txt);
      console.log('  → revise prompt 已落盘（内含被 hold 的草稿原文）');
    }
  "
fi
echo
echo "### 证据落盘于 $OUT"