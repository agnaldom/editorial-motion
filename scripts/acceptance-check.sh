#!/usr/bin/env bash
set -euo pipefail

output_file="${1:-apps/renderer/out/scene01.mp4}"

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "acceptance-check: ffprobe is required to inspect MP4 output" >&2
  exit 1
fi
if [[ ! -f "$output_file" ]]; then
  echo "acceptance-check: output not found: $output_file" >&2
  exit 1
fi

width="$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 "$output_file" | tr -d ',')"
height="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$output_file" | tr -d ',')"
fps="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=nw=1:nk=1 "$output_file" | tr -d ',')"
codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$output_file" | tr -d ',')"
duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$output_file" | tr -d ',')"
format="$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$output_file" | tr -d ',')"

[[ "$width" == "2560" && "$height" == "1440" ]] || { echo "acceptance-check: expected 2560x1440, got ${width}x${height}" >&2; exit 1; }
[[ "$fps" == "30/1" ]] || { echo "acceptance-check: expected 30fps, got $fps" >&2; exit 1; }
[[ "$codec" == "h264" ]] || { echo "acceptance-check: expected H.264, got $codec" >&2; exit 1; }
[[ "$format" == *"mp4"* ]] || { echo "acceptance-check: expected MP4 container, got $format" >&2; exit 1; }

awk -v duration="$duration" 'BEGIN { if (duration < 7.9 || duration > 8.1) exit 1 }' || {
  echo "acceptance-check: expected 8s duration, got ${duration}s" >&2
  exit 1
}

echo "acceptance-check: PASS ($output_file: 2560x1440, 30fps, 8s, H.264/MP4)"
