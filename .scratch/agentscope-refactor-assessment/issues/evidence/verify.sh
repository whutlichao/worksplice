#!/usr/bin/env bash
# 本报告作者（research 票 worker）对票面「起点假设」与全部外部事实的**独立重跑**脚本。
#
# 与既有 `collect.sh` 的关系：`collect.sh` 与 E01–E38 是本 worktree 里既有的取证语料；
# 本脚本把同一批命令重跑一遍，产物落 `R##-*` 前缀，用于「以我自己的运行结果为准」的核对。
# 两套语料凡逐字一致者，在文档里注明；不一致者以本脚本为准并记下差异。
#
# 用法：REPO=<repo> AUDIT=<tmpdir> bash verify.sh
set -u
set -o pipefail

REPO="${REPO:-$(git rev-parse --show-toplevel)}"
AUDIT="${AUDIT:-/tmp/as-verify}"
EV="$REPO/.scratch/agentscope-refactor-assessment/issues/evidence"
mkdir -p "$AUDIT"
cd "$REPO"

# ============================================================
# A. 本仓事实（消费侧）—— 票面「起点假设」逐条重跑
# ============================================================

# A1. pi 耦合面：三种读法
#  (a) 票面命令原文（无 --include，会算上 docs/.scratch 里的文字引用）
grep -rn "@earendil-works" "$REPO" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  > "$AUDIT/R01a-pi-ref-hits-all.txt" 2>/dev/null || true
grep -rl "@earendil-works" "$REPO" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  > "$AUDIT/R01b-pi-ref-files-all.txt" 2>/dev/null || true
#  (b) 源码后缀（ts/tsx/mjs）
grep -rn "@earendil-works" "$REPO" --include="*.ts" --include="*.tsx" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.next > "$AUDIT/R01c-pi-ref-hits-source.txt" 2>/dev/null || true
grep -rl "@earendil-works" "$REPO" --include="*.ts" --include="*.tsx" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.next > "$AUDIT/R01d-pi-ref-files-source.txt" 2>/dev/null || true
#  (c) impl 面 = 源码后缀 - *.test.mjs + next.config.ts
( cd "$REPO" && grep -rn "@earendil-works" app lib components hooks next.config.ts \
    --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\.test\.mjs" ) \
  > "$AUDIT/R01e-pi-ref-hits-impl.txt" || true
( cd "$REPO" && grep -rln "@earendil-works" app lib components hooks next.config.ts \
    --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\.test\.mjs" ) \
  > "$AUDIT/R01f-pi-ref-files-impl.txt" || true
#  逐文件行数 + 合计
( cd "$REPO" && cat "$AUDIT/R01f-pi-ref-files-impl.txt" | tr '\n' '\0' | xargs -0 wc -l \
    | grep -v ' total$' | sort -rn ) > "$AUDIT/R01g-pi-ref-impl-lines-per-file.txt" || true
( cd "$REPO" && cat "$AUDIT/R01f-pi-ref-files-impl.txt" | tr '\n' '\0' | xargs -0 cat | wc -l ) \
  > "$AUDIT/R01h-pi-ref-impl-lines-total.txt" || true
{ echo "hits_all=$(wc -l < "$AUDIT/R01a-pi-ref-hits-all.txt" | tr -d ' ')"
  echo "files_all=$(wc -l < "$AUDIT/R01b-pi-ref-files-all.txt" | tr -d ' ')"
  echo "hits_source=$(wc -l < "$AUDIT/R01c-pi-ref-hits-source.txt" | tr -d ' ')"
  echo "files_source=$(wc -l < "$AUDIT/R01d-pi-ref-files-source.txt" | tr -d ' ')"
  echo "hits_impl=$(wc -l < "$AUDIT/R01e-pi-ref-hits-impl.txt" | tr -d ' ')"
  echo "files_impl=$(wc -l < "$AUDIT/R01f-pi-ref-files-impl.txt" | tr -d ' ')"
  echo "lines_impl=$(cat "$AUDIT/R01h-pi-ref-impl-lines-total.txt" | tr -d ' ')"
} > "$AUDIT/R01i-pi-ref-summary.txt"

# A2. 适配器行数（三法自洽：wc -l / grep -c '' / awk END{NR}）
for f in "lib/rpc/session.ts" "lib/session-reader.ts" "lib/agent-runtime.ts" \
         "app/api/sessions/[id]/export/route.ts" "lib/session-stats.ts" "lib/rpc/caller.ts" \
         "lib/pi-types.ts"; do
  printf '%-45s wc-l=%s grep-c=%s awkNR=%s lastbyte=%s\n' "$f" \
    "$(wc -l < "$f" | tr -d ' ')" "$(grep -c '' "$f")" "$(awk 'END{print NR}' "$f")" \
    "$(tail -c1 "$f" | xxd -p)"
done > "$AUDIT/R02-adapter-lines.txt"

# A3. 规模：实现（ts/tsx，非 *.test.mjs）
for d in app lib components hooks; do
  printf '%-11s ts+tsx=%s\n' "$d" \
    "$(find "$d" -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.mjs" -exec cat {} + | wc -l | tr -d ' ')"
done > "$AUDIT/R03a-scale-impl-lines.txt"
printf 'TOTAL %s\n' \
  "$(find app lib components hooks -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.mjs" -exec cat {} + | wc -l | tr -d ' ')" \
  >> "$AUDIT/R03a-scale-impl-lines.txt"
printf 'FILES %s\n' \
  "$(find app lib components hooks -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.mjs" | wc -l | tr -d ' ')" \
  >> "$AUDIT/R03a-scale-impl-lines.txt"
find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" \
  | sed "s|^\./||" | sort > "$AUDIT/R03b-test-files.txt"
printf 'test_files=%s test_lines=%s\n' \
  "$(wc -l < "$AUDIT/R03b-test-files.txt" | tr -d ' ')" \
  "$(find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" -exec cat {} + | wc -l | tr -d ' ')" \
  > "$AUDIT/R03c-test-summary.txt"

# A4. 路由与域计数
find app/api -name "route.ts" | wc -l > "$AUDIT/R04a-api-routes-count.txt"
grep -rl "@earendil-works" app/api | sort > "$AUDIT/R04b-api-routes-touching-pi.txt"
grep -rl "@earendil-works" app/api | grep -c "route\.ts$" > "$AUDIT/R04c-api-route-files-touching-pi.txt"
for d in lib/domain/collab lib/data lib/agent-loop; do
  printf '%-20s impl=%s test=%s\n' "$d" \
    "$(find "$d" -maxdepth 1 -name '*.ts' ! -name '*.test.ts' | wc -l | tr -d ' ')" \
    "$(find "$d" -maxdepth 1 -name '*.test.mjs' | wc -l | tr -d ' ')"
done > "$AUDIT/R04d-domain-counts.txt"
for d in app lib components hooks; do
  printf '%-11s test=%s\n' "$d" "$(find "$d" -name '*.test.mjs' | wc -l | tr -d ' ')"
done > "$AUDIT/R04e-test-files-by-dir.txt"

# A5. 包版本
grep -n "earendil-works" package.json > "$AUDIT/R05a-worksplice-pi-pin.txt"
grep -n "earendil-works" bun.lock | head -8 > "$AUDIT/R05b-bunlock-pi-pin.txt"
grep -n "SCHEMA_VERSION" lib/data/schema.ts | head -2 > "$AUDIT/R05c-schema-version.txt"

# A6. 关键 seam 的 文件:行号（文档引用用）
{
  echo "## worksplice seams"
  grep -n "^export class AgentSessionWrapper" lib/rpc/session.ts
  grep -n "^export interface AgentRuntime" lib/agent-runtime.ts
  grep -n "^  findSession\|^  startSession\|^  destroySession\|^  findBusySessionForCwd" lib/agent-runtime.ts
  grep -n "^export interface LoopSession\|^export interface LoopRuntime" lib/agent-loop/loop.ts
  grep -n "^export function runAgentRound\|^export function parseAgentAction\|^export async function deliverWithFreshness" lib/agent-loop/loop.ts
  grep -n "^export function guideFileOperations\|^export function guardFileOperations\|^export const CODING_TOOL_NAMES\|^export function getToolNamesForPreset" lib/tool-path-guard-extension.ts lib/tool-presets.ts
  grep -n "^export function gateBashSandbox\|^export function planBashSandbox" lib/bash-containment.ts
  grep -n "^export function createContainedBash" lib/bash-containment-extension.ts
  grep -n "^export const CODING_TOOL_NAMES" lib/tool-presets.ts
  grep -n "export.*extensionFactories" lib/rpc/caller.ts
  grep -n "UNIQUE (target_id, seq)\|CREATE TABLE IF NOT EXISTS consumed_seqs\|CREATE TABLE IF NOT EXISTS tasks" lib/data/schema.ts
  grep -n "^export function searchMessages" lib/domain/collab/search.ts
  grep -n "^export interface Store" lib/data/store.ts
} > "$AUDIT/R06-worksplice-seam-anchors.txt" 2>&1

# ============================================================
# B. AgentScope TS 0.0.15（npm registry + tarball）
# ============================================================
npm view @agentscope-ai/agentscope --json > "$AUDIT/R10-npm-view-agentscope-ts.json"
npm view @agentscope-ai/agentscope@0.0.15 --json > "$AUDIT/R11-npm-view-agentscope-ts-0.0.15.json"
npm view @agentscope-ai/agentscope time --json > "$AUDIT/R12-npm-time-agentscope-ts.json"
npm view @agentscope-ai/agentscope dist-tags --json > "$AUDIT/R13-npm-dist-tags-agentscope-ts.json"
( cd "$AUDIT" && cp "$REPO/agentscope-ai-agentscope-0.0.15.tgz" . 2>/dev/null || npm pack @agentscope-ai/agentscope@0.0.15 )
mkdir -p "$AUDIT/ts-0.0.15"
tar xzf "$AUDIT/agentscope-ai-agentscope-0.0.15.tgz" -C "$AUDIT/ts-0.0.15"
TS="$AUDIT/ts-0.0.15/package"
cat "$TS/package.json" > "$AUDIT/R14-ts-package.meta.txt"
find "$TS/src" -name "*.ts" ! -name "*.test.ts" -exec wc -l {} + | sort -rn > "$AUDIT/R15-ts-src-lines.txt"
find "$TS/src" -name "*.ts" ! -name "*.test.ts" | sed "s|$TS/||" | sort > "$AUDIT/R16-ts-src-files.txt"
cat "$TS/src/agent/index.ts" "$TS/src/model/index.ts" "$TS/src/tool/index.ts" \
    "$TS/src/storage/index.ts" "$TS/src/permission/index.ts" "$TS/src/state/index.ts" \
    "$TS/src/formatter/index.ts" "$TS/src/mcp/index.ts" "$TS/src/message/index.ts" \
  > "$AUDIT/R17-ts-export-surface.ts"
grep -rniE "sandbox|workspace|chroot|seccomp|bwrap" "$TS/src" --include=*.ts | grep -v "\.test\.ts" \
  > "$AUDIT/R18-ts-sandbox-workspace-grep.txt" || true
grep -rniE "\b(hub|pipeline|team|swarm|orchestrat|sub_?agent|multi.?agent)\b" "$TS/src" --include=*.ts \
  | grep -v "\.test\.ts" > "$AUDIT/R19-ts-orchestration-grep.txt" || true
grep -rniE "\b(fork|navigate|rewind|branch|resume|checkpoint|compaction)\b" "$TS/src" --include=*.ts \
  | grep -v "\.test\.ts" > "$AUDIT/R20-ts-fork-navigate-grep.txt" || true
grep -rn "checkPermissions\|PermissionEngine\|permission" "$TS/src" --include=*.ts | grep -v "\.test\.ts" \
  > "$AUDIT/R21-ts-permission-usage.txt" || true
grep -rniE "oauth|login|auth|credential" "$TS/src" --include=*.ts | grep -v "\.test\.ts" \
  > "$AUDIT/R22-ts-auth-grep.txt" || true
grep -rn "^export class\|^export abstract class\|^export interface\|^export function\|^export enum\|^export type" \
  "$TS/src" --include=*.ts | grep -v "\.test\.ts" > "$AUDIT/R23-ts-exported-symbols.txt" || true

# ============================================================
# C. AgentScope Python 2.0.10（PyPI JSON API + wheel）
# ============================================================
curl -s https://pypi.org/pypi/agentscope/json > "$AUDIT/R30-pypi-agentscope.json"
curl -s https://pypi.org/pypi/agentscope-runtime/json > "$AUDIT/R31-pypi-agentscope-runtime.json"
python3 - "$AUDIT" <<'PY'
import json, sys
a = sys.argv[1]
info = json.load(open(f"{a}/R30-pypi-agentscope.json"))["info"]
with open(f"{a}/R32-py-requires-dist.txt", "w") as f:
    f.write(f"version={info['version']}\nrequires_python={info['requires_python']}\n")
    f.write(f"summary={info['summary']}\nproject_urls={json.dumps(info['project_urls'], ensure_ascii=False)}\n")
    f.write(f"requires_dist_count={len(info['requires_dist'])}\n")
    for r in info["requires_dist"]:
        f.write(r + "\n")
rt = json.load(open(f"{a}/R31-pypi-agentscope-runtime.json"))["info"]
with open(f"{a}/R33-py-runtime-requires-dist.txt", "w") as f:
    f.write(f"version={rt['version']}\nrequires_python={rt['requires_python']}\nsummary={rt['summary']}\n")
    for r in rt["requires_dist"]:
        f.write(r + "\n")
PY
WHL_URL=$(python3 -c "
import json;d=json.load(open('$AUDIT/R30-pypi-agentscope.json'))
print([u['url'] for u in d['urls'] if u['packagetype']=='bdist_wheel'][0])")
curl -sL -o "$AUDIT/agentscope-2.0.10-py3-none-any.whl" "$WHL_URL"
python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
  "$AUDIT/agentscope-2.0.10-py3-none-any.whl" "$AUDIT/py-2.0.10"
PY2="$AUDIT/py-2.0.10/agentscope"
find "$PY2" -name "*.py" | sed "s|$PY2/||" | sort > "$AUDIT/R34-py-module-inventory.txt"
find "$PY2" -name "*.py" -exec cat {} + | wc -l > "$AUDIT/R35-py-total-lines.txt"
for d in "$PY2"/*/; do printf '%-14s %s\n' "$(basename "$d")" "$(find "$d" -name '*.py' | wc -l | tr -d ' ')"; done \
  > "$AUDIT/R36-py-dir-file-counts.txt"
cat "$PY2/workspace/__init__.py" "$PY2/permission/__init__.py" "$PY2/pipeline/__init__.py" \
    "$PY2/model/__init__.py" "$PY2/state/__init__.py" "$PY2/tool/__init__.py" \
  > "$AUDIT/R37-py-export-surface.py"
grep -rn "share_net\|unshare\|bwrap\|--share-net\|--unshare-all" "$PY2/workspace/_bubblewrap/_bubblewrap_backend.py" \
  > "$AUDIT/R38-py-bubblewrap-network.txt" || true
grep -rniE "consumed_seq|read_seq|freshness|base_seq|max_seq" --include=*.py "$PY2" \
  > "$AUDIT/R39-py-cursor-vocabulary-grep.txt" || true
grep -rniE "\b(in_review|approve|reject|reopen|unclaim)\b" --include=*.py "$PY2" \
  > "$AUDIT/R40-py-task-review-grep.txt" || true
grep -rniE "\b(fork|navigate|rewind|branch|checkpoint)\b" --include=*.py "$PY2" \
  > "$AUDIT/R41-py-fork-navigate-grep.txt" || true
grep -rn "__tablename__" "$PY2/app/storage/_sql/_tables.py" > "$AUDIT/R42-py-sql-tables.txt" || true
grep -rn "session_id\|msg_id\|primary_key" "$PY2/app/storage/_sql/_tables.py" | sed -n '1,40p' \
  >> "$AUDIT/R42-py-sql-tables.txt" || true

# ============================================================
# D. GitHub 一手（API / raw）
# ============================================================
curl -s "https://api.github.com/orgs/agentscope-ai/repos?per_page=100" > "$AUDIT/R50-gh-org-repos.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-typescript" > "$AUDIT/R51-gh-repo-ts.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope" > "$AUDIT/R52-gh-repo-py.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-runtime" > "$AUDIT/R53-gh-repo-runtime.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-typescript/git/trees/main?recursive=1" \
  > "$AUDIT/R54-gh-ts-tree.json"
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/README.md \
  > "$AUDIT/R55-gh-ts-readme.md"
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/packages/agentscope/package.json \
  > "$AUDIT/R56-gh-ts-package.meta.txt"
curl -s "https://registry.npmjs.org/-/v1/search?text=%40agentscope-ai&size=50" \
  > "$AUDIT/R57-npm-search-agentscope-ai.json"

echo "OK -> $AUDIT"
