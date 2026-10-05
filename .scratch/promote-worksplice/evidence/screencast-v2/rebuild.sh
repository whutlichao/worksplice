#!/usr/bin/env bash
# Rebuild the assembled index: restore hoisted videos -> assemble -> inject transitions -> verify.
# Usage: bash rebuild.sh [--storyboard STORYBOARD.md]
set -euo pipefail
cd "$(dirname "$0")"
SB="${2:-STORYBOARD.md}"
[ "${1:-}" = "--storyboard" ] || SB="STORYBOARD.md"
bash .hyperframes/video-sources/restore.sh
node ~/.agents/skills/product-launch-video/scripts/assemble-index.mjs --storyboard "$(pwd)/$SB" --hyperframes "$(pwd)" | tail -6
node ~/.agents/skills/product-launch-video/scripts/transitions.mjs inject --storyboard "$(pwd)/$SB" --hyperframes "$(pwd)" | tail -3
node ~/.agents/skills/product-launch-video/scripts/transitions.mjs verify --storyboard "$(pwd)/$SB" --index "$(pwd)/index.html" | tail -2
node .hyperframes/video-sources/patch-stacking.mjs "$(pwd)/index.html"
echo "videos in index: $(grep -c '<video' index.html)"
echo "videos in frames: $(grep -l '<video' compositions/frames/*.html 2>/dev/null | wc -l | tr -d ' ') file(s)"
