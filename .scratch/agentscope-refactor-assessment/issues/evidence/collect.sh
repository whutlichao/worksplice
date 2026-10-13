#!/usr/bin/env bash
# 本票（research）全部一手取证的命令原文。
# 用 $PWD 是仓库根，$AS_AUDIT 是 /tmp 下的解包区（`npm pack` / wheel 解包产物）。
#
# 用法：REPO=<repo> AS_AUDIT=<tmpdir> bash collect.sh
set -u
set -o pipefail

REPO="${REPO:-$(git rev-parse --show-toplevel)}"
AS_AUDIT="${AS_AUDIT:-/tmp/as-audit}"
EV="$REPO/.scratch/agentscope-refactor-assessment/issues/evidence"

# ---- A. 本仓事实（消费侧） -------------------------------------------------

# A1. pi 包名引用。三种读法都留证：
#  (a) 票面命令原文：`grep -rn "@earendil-works" . --exclude-dir=node_modules --exclude-dir=.next`
#      —— 没有 `--include`，会把 docs/.scratch/.codegraph 下的文字引用一并算进去（.codegraph 是 sqlite 二进制，
#      会往 stderr 吐一句 Operation not supported）。
#  (b) 只看源码后缀（ts/tsx/mjs）：这才是「代码引用面」。
#  (c) impl = (b) 去掉 *.test.mjs，再加上仓库根 next.config.ts（它不是 ts/tsx/mjs）。
grep -rn "@earendil-works" "$REPO" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir=.codegraph 2>/dev/null > "$EV/E12a-grep-pi-ref-all-hits.txt" || true
grep -rl "@earendil-works" "$REPO" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir=.codegraph 2>/dev/null > "$EV/E12b-grep-pi-ref-all-files.txt" || true
grep -rn "@earendil-works" "$REPO" --include="*.ts" --include="*.tsx" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.next 2>/dev/null > "$EV/E13-grep-pi-ref-source-hits.txt" || true
grep -rl "@earendil-works" "$REPO" --include="*.ts" --include="*.tsx" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.next 2>/dev/null > "$EV/E12-grep-pi-ref-source-files.txt" || true
( cd "$REPO" && grep -rln "@earendil-works" app lib components hooks next.config.ts \
    --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\.test\.mjs" ) \
  > "$EV/E14-pi-importing-impl-files.txt" || true
( cd "$REPO" && cat "$EV/E14-pi-importing-impl-files.txt" | tr '\n' '\0' | xargs -0 wc -l | sort -rn ) \
  > "$EV/E15-pi-importing-impl-lines.txt" || true
( cd "$REPO" && grep -rn "@earendil-works" app lib components hooks next.config.ts \
    --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\.test\.mjs" | wc -l ) \
  > "$EV/E15b-pi-importing-impl-hits.txt" || true

# A2. 适配器行数
wc -l "$REPO/lib/rpc/session.ts" "$REPO/lib/session-reader.ts" "$REPO/lib/agent-runtime.ts" \
  "$REPO/app/api/sessions/[id]/export/route.ts" "$REPO/lib/session-stats.ts" \
  "$REPO/lib/rpc/caller.ts" "$REPO/lib/pi-types.ts" > "$EV/E16-adapter-lines.txt"

# A3. 规模
for d in app lib components hooks; do
  printf '%s ' "$d"
  find "$REPO/$d" -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.mjs" -exec cat {} + | wc -l
done > "$EV/E17-scale-impl-lines.txt"
find "$REPO" -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -not -path "*/.git/*" | sed "s|$REPO/||" | sort > "$EV/E18-test-files.txt"
find "$REPO" -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -not -path "*/.git/*" -exec cat {} + | wc -l > "$EV/E19-test-lines.txt"

# A4. 路由与域计数
find "$REPO/app/api" -name "route.ts" | wc -l          > "$EV/E20-api-routes-count.txt"
grep -rl "@earendil-works" "$REPO/app/api" | sort      > "$EV/E21-api-routes-touching-pi.txt"
for d in lib/domain/collab lib/data lib/agent-loop; do
  printf '%s impl=%s test=%s\n' "$d" \
    "$(find "$REPO/$d" -maxdepth 1 -name '*.ts' ! -name '*.test.ts' | wc -l | tr -d ' ')" \
    "$(find "$REPO/$d" -maxdepth 1 -name '*.test.mjs' | wc -l | tr -d ' ')"
done > "$EV/E22-domain-counts.txt"

# A5. 包版本
grep -n "earendil-works" "$REPO/package.json" > "$EV/E23-worksplice-pi-pin.txt"

# ---- B. AgentScope TS（npm registry + tarball） ----------------------------

npm view @agentscope-ai/agentscope --json            > "$EV/E01-npm-view-agentscope-ts.json"
npm view @agentscope-ai/agentscope@0.0.15 --json     > "$EV/E02-npm-view-agentscope-ts-0.0.15.json"
npm pack @agentscope-ai/agentscope@0.0.15            > "$EV/E03-npm-pack-agentscope-ts-0.0.15.txt"
mkdir -p "$AS_AUDIT/ts-0.0.15"
tar xzf agentscope-ai-agentscope-0.0.15.tgz -C "$AS_AUDIT/ts-0.0.15"
TS="$AS_AUDIT/ts-0.0.15/package"
cat "$TS/src/agent/index.ts" "$TS/src/model/index.ts" "$TS/src/tool/index.ts" \
    "$TS/src/storage/index.ts" "$TS/src/permission/index.ts" "$TS/src/state/index.ts" \
    > "$EV/E24-agentscope-ts-export-surface.ts"
grep -rn "checkPermissions" "$TS/src"                     > "$EV/E25-ts-checkPermissions-usage.txt"
grep -rniE "sandbox|workspace|chroot|seccomp|bwrap" "$TS/src" --include=*.ts \
  | grep -v "\.test\.ts"                                  > "$EV/E26-ts-sandbox-workspace-grep.txt"
grep -rniE "\b(hub|pipeline|team|swarm|orchestrat|sub_?agent|multi.?agent)\b" "$TS/src" \
  --include=*.ts | grep -v "\.test\.ts"                    > "$EV/E27-ts-orchestration-grep.txt"
find "$TS/src" -name "*.ts" ! -name "*.test.ts" -exec wc -l {} + | tail -1 \
  > "$EV/E28-ts-src-lines.txt"
grep -n "taskStore" "$TS/src/tool/task.ts"                > "$EV/E29-ts-task-store.txt"

# ---- C. AgentScope Python 2.x（PyPI JSON API + wheel） ----------------------

curl -s https://pypi.org/pypi/agentscope/json          > "$EV/E04-pypi-agentscope.json"
curl -s https://pypi.org/pypi/agentscope-runtime/json  > "$EV/E05-pypi-agentscope-runtime.json"
python3 - "$EV" <<'PY'
import json, sys
ev = sys.argv[1]
info = json.load(open(f"{ev}/E04-pypi-agentscope.json"))["info"]
with open(f"{ev}/E30-pypi-agentscope-requires-dist.txt", "w") as f:
    f.write(f"version={info['version']} requires_python={info['requires_python']}\n")
    for r in info["requires_dist"]:
        f.write(r + "\n")
PY
curl -sL -o "$AS_AUDIT/agentscope-2.0.10-py3-none-any.whl" "$(python3 - <<'PY'
import json
d = json.load(open('/tmp/as-audit/pypi-agentscope.json'))
print([u['url'] for u in d['releases']['2.0.10'] if u['packagetype'] == 'bdist_wheel'][0])
PY
)"
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
  "$AS_AUDIT/agentscope-2.0.10-py3-none-any.whl" "$AS_AUDIT/py-2.0.10"
PY2="$AS_AUDIT/py-2.0.10/agentscope"
find "$PY2" -name "*.py" | sed "s|$PY2/||" | sort > "$EV/E31-py-module-inventory.txt"
cat "$PY2/workspace/__init__.py" "$PY2/permission/__init__.py" \
    "$PY2/pipeline/__init__.py"                     > "$EV/E32-py-workspace-permission-pipeline-exports.txt"
grep -n "share_net\|unshare\|bwrap" "$PY2/workspace/_bubblewrap/_bubblewrap_backend.py" \
  > "$EV/E33-py-bubblewrap-network.txt"
grep -rniE "consumed_seq|read_seq|freshness|base_seq|max_seq" --include=*.py "$PY2" \
  > "$EV/E34-py-cursor-vocabulary-grep.txt" || true
cat "$PY2/app/storage/_sql/_alembic/versions/0001_initial.py" \
    "$PY2/app/storage/_sql/_alembic/versions/0003_channels.py" \
  > "$EV/E35-py-sql-tables.txt"
grep -rniE "\b(fork|navigate|rewind)\b" --include=*.py "$PY2" > "$EV/E36-py-fork-navigate-grep.txt" || true
cat "$PY2/model/_model_usage.py"                     > "$EV/E37-py-model-usage.txt"

# ---- D. GitHub 一手（API / raw） --------------------------------------------

curl -s "https://api.github.com/orgs/agentscope-ai/repos?per_page=100" \
  > "$EV/E06-github-org-agentscope-ai-repos.json"
curl -s "https://api.github.com/search/repositories?q=agentscope+in:name+language:TypeScript" \
  > "$EV/E07-github-search-agentscope-typescript.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-typescript/git/trees/main?recursive=1" \
  > "$EV/E08-github-agentscope-typescript-tree.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope"            > "$EV/E09-github-repo-agentscope.json"
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-typescript" > "$EV/E10-github-repo-agentscope-typescript.json"
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/packages/agentscope/package.json \
  > "$EV/E11-github-agentscope-typescript-package-agentscope.json"
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/pnpm-workspace.yaml \
  > "$EV/E38-github-agentscope-typescript-pnpm-workspace.yaml"
