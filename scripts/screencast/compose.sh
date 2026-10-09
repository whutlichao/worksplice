#!/usr/bin/env bash
# 90 秒介绍视频 · 合成脚本
#
# 输入：capture.mjs 产出的 manifest.json + frames/shotNN/*.png
# 输出：<OUT>/worksplice-90s.mp4（1600×900 / 30fps / h264 / ≤8MB）
#
# ffmpeg 只做编码与拼接——本机构建不含 drawtext/subtitles，运镜与字幕已在捕获阶段逐帧烧进 PNG。
# 每镜独立编码为近无损段（crf 16 / yuv420p / 30fps / 固定 GOP），concat 成中间母版；
# 再对母版做两遍 ABR（默认 620kbps）收口到 ≤8MB。时长由帧数精确决定，总长 90.0s。
#
# 用法：OUT=/path/to/scratch bash scripts/screencast/compose.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$REPO/.scratch/screencast-90s-v2}"
MANIFEST="$OUT/manifest.json"

[ -f "$MANIFEST" ] || { echo "缺少 ${MANIFEST}（先跑 capture.mjs）" >&2; exit 1; }

FPS=$(node -e "console.log(require('$MANIFEST').fps)")
N=$(node -e "console.log(require('$MANIFEST').shots.length)")
mkdir -p "$OUT/segments"

echo "== 段编码（$N 镜 @ ${FPS}fps）"
LIST="$OUT/segments/list.txt"
: > "$LIST"
EXPECTED=0
for i in $(seq 0 $((N - 1))); do
  read -r IDX NAME DIR FRAMES STATIC SOURCE <<<"$(node -e "
    const s = require('$MANIFEST').shots[$i];
    console.log(s.index, s.name, s.dir ?? '-', s.frames, s.static ? 1 : 0, s.source ?? '-');
  ")"
  SEG="$OUT/segments/seg$(printf '%02d' "$IDX").mp4"
  EXPECTED=$((EXPECTED + FRAMES))
  if [ "$STATIC" = "1" ]; then
    ffmpeg -loglevel error -y -loop 1 -framerate "$FPS" -i "$OUT/$SOURCE" -t "$(node -e "console.log(($FRAMES / $FPS).toFixed(3))")" \
      -vf "scale=1600:900,format=yuv420p" -r "$FPS" -c:v libx264 -preset medium -crf 16 -g 60 -keyint_min 60 -sc_threshold 0 "$SEG"
  else
    ffmpeg -loglevel error -y -framerate "$FPS" -i "$OUT/$DIR/%04d.png" \
      -vf "format=yuv420p" -r "$FPS" -c:v libx264 -preset medium -crf 16 -g 60 -keyint_min 60 -sc_threshold 0 "$SEG"
  fi
  echo "file '$SEG'" >> "$LIST"
  echo "  seg$(printf '%02d' "$IDX") $NAME  ${FRAMES}f = $(node -e "console.log(($FRAMES / $FPS).toFixed(2))")s"
done

echo "== 拼接（中间母版）"
MASTER="$OUT/segments/master.mp4"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$LIST" -c copy "$MASTER"

echo "== 两遍 ABR 收口（目标 ${TARGET_KBPS:-620}kbps → ≤8MB）"
TARGET_KBPS="${TARGET_KBPS:-620}"
PASSLOG="$OUT/segments/ffpass"
ffmpeg -loglevel error -y -i "$MASTER" -c:v libx264 -preset slow -b:v "${TARGET_KBPS}k" -maxrate "$((TARGET_KBPS * 2))k" -bufsize "$((TARGET_KBPS * 4))k" \
  -pix_fmt yuv420p -pass 1 -passlogfile "$PASSLOG" -an -f mp4 /dev/null
ffmpeg -loglevel error -y -i "$MASTER" -c:v libx264 -preset slow -b:v "${TARGET_KBPS}k" -maxrate "$((TARGET_KBPS * 2))k" -bufsize "$((TARGET_KBPS * 4))k" \
  -pix_fmt yuv420p -pass 2 -passlogfile "$PASSLOG" -an -movflags +faststart "$OUT/worksplice-90s.mp4"

echo "== 校验"
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 "$OUT/worksplice-90s.mp4"
node -e "
const m = require('$MANIFEST');
const total = m.shots.reduce((a, s) => a + s.frames, 0);
console.log('manifest 总帧数 ' + total + ' = ' + (total / m.fps).toFixed(2) + 's（应为 90.00s）');
"
SZ=$(stat -f%z "$OUT/worksplice-90s.mp4" 2>/dev/null || stat -c%s "$OUT/worksplice-90s.mp4")
echo "成品 $(printf '%.2f' "$(echo "$SZ / 1048576" | bc -l)") MB"
[ "$SZ" -le $((8 * 1024 * 1024)) ] || { echo "超过 8MB 预算" >&2; exit 1; }
