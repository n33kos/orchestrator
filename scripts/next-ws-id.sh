#!/usr/bin/env bash
# next-ws-id.sh — Atomically increment the work stream counter and print the new ID.
#
# Output: ws-NNN (zero-padded to 3 digits)
#
# Uses a lockfile (mkdir-based) to prevent race conditions when multiple
# callers (discover-work.py, add-work skill, etc.) generate IDs concurrently.
# mkdir is atomic on all POSIX systems including macOS.

set -euo pipefail

COUNTER_FILE="${HOME}/.claude/orchestrator/ws-counter"
LOCK_DIR="${COUNTER_FILE}.lock"

# Bootstrap the counter file if it doesn't exist yet.
if [[ ! -f "$COUNTER_FILE" ]]; then
  mkdir -p "$(dirname "$COUNTER_FILE")"
  echo -n "0" > "$COUNTER_FILE"
fi

# Acquire lock — mkdir is atomic. Retry with backoff up to ~2 seconds.
attempts=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [[ $attempts -ge 20 ]]; then
    echo "ERROR: Could not acquire lock after 20 attempts" >&2
    exit 1
  fi
  sleep 0.1
done

# Ensure lock is released on exit (normal, error, or signal).
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Read, increment, write.
current=$(cat "$COUNTER_FILE")
current=${current:-0}

# The counter can fall behind when IDs are assigned without going through this
# script. Reissuing a used ID would collide with its plan file, worktree, and
# session name, so take the high-water mark across the queue and the archive.
HIGHEST="$(
  find "${HOME}/.claude/orchestrator" -maxdepth 2 \
    \( -name 'queue.json' -o -path '*/archive/*.json' \) -type f -print0 2>/dev/null |
  xargs -0 grep -ho 'ws-[0-9]\{1,\}' 2>/dev/null |
  sed 's/ws-0*//' |
  sort -n |
  tail -1
)"
if [[ -n "$HIGHEST" && "$HIGHEST" -gt "$current" ]]; then
  current="$HIGHEST"
fi

next=$((current + 1))
echo -n "$next" > "$COUNTER_FILE"

printf "ws-%03d\n" "$next"
