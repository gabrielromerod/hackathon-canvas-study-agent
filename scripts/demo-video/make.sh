#!/usr/bin/env bash
# Rebuild the README demo film, its loop and poster from the raw demo-workspace recording.
# Needs ffmpeg, Node.js with Playwright (Chromium), and Python 3 with numpy and scipy.
# Usage: scripts/demo-video/make.sh [path/to/demo-capture.mp4]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="${1:-$ROOT/artifacts/portfolio/demo-capture.mp4}"
WORK="$ROOT/artifacts/demo-video"
OUT="$ROOT/docs/media"
mkdir -p "$WORK/raw" "$WORK/frames"

# 1. Raw frames used by the timeline (start second, duration), numbered by raw frame index at 30 fps.
for range in "0 27" "79 26" "105 16" "128 8"; do
  set -- $range
  ffmpeg -v error -y -ss "$1" -i "$SRC" -t "$2" -start_number $(( $1 * 30 )) -q:v 2 "$WORK/raw/f_%05d.jpg"
done

# 2. Render 60 s at 30 fps from the HTML timeline.
node "$HERE/render.mjs" "$HERE/stage.html" "$WORK/raw" "$WORK/frames" 0 1800

# 3. Synthesize the original score and normalise it to -16 LUFS.
python3 "$HERE/music.py" "$WORK/score-raw.wav"
ffmpeg -v error -y -i "$WORK/score-raw.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 "$WORK/score.wav"

# 4. Encode the film, the README loop (ask, evidence, memory) and the poster frame.
ffmpeg -v error -y -framerate 30 -i "$WORK/frames/%05d.jpg" -i "$WORK/score.wav" -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -tune animation -c:a aac -b:a 192k \
  -movflags +faststart -shortest "$OUT/demo.mp4"
ffmpeg -v error -y -i "$OUT/demo.mp4" -filter_complex \
  "[0:v]trim=22:32,setpts=PTS-STARTPTS[a];[0:v]trim=32:38,setpts=PTS-STARTPTS[b];[0:v]trim=38:44,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1[v]" \
  -map "[v]" -an -c:v libx264 -crf 18 -pix_fmt yuv420p "$WORK/loop-src.mp4"
ffmpeg -v error -y -i "$WORK/loop-src.mp4" -vf \
  "crop=1660:1000:100:40,fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$OUT/demo-loop.gif"
ffmpeg -v error -y -ss 30.6 -i "$OUT/demo.mp4" -frames:v 1 "$OUT/demo-poster.png"
echo "Wrote $OUT/demo.mp4, demo-loop.gif and demo-poster.png"
