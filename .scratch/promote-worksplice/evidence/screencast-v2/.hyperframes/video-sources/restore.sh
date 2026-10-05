#!/usr/bin/env bash
# Restore hoisted video declarations into frame files before (re-)assembly.
# assemble-index.mjs replaces approved frame videos with comment placeholders in place.
set -euo pipefail
cd "$(dirname "$0")/../.."
for src in .hyperframes/video-sources/*.videos.html; do
  frame=$(basename "$src" .videos.html)
  f="compositions/frames/$frame.html"
  if ! grep -q '</video>' "$f"; then
    # insert after the frame's ground clip line (first class="clip" div) or fallback: after root div
    python3 - "$f" "$src" <<'PY'
import sys
f, src = sys.argv[1], sys.argv[2]
lines = open(f).read().split("\n")
videos = open(src).read().rstrip("\n").split("\n")
out=[]; inserted=False
for i,l in enumerate(lines):
    out.append(l)
    if not inserted and ('<!-- approved frame video hoisted' in l):
        # skip existing placeholders until block end
        continue
    if not inserted and 'class="clip' in l and 'data-start' in l:
        out.extend(videos); inserted=True
if not inserted:
    for i,l in enumerate(out):
        if '<div id="root"' in l:
            out[i+1:i+1] = videos; inserted=True; break
open(f,'w').write("\n".join(out))
print(('restored ' if inserted else 'FAILED ') + f)
PY
  else
    echo "ok (videos present) $f"
  fi
done
