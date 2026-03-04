#!/usr/bin/env bash
# Install or uninstall the orchestrator scheduler as a launchd daemon.
#
# Usage:
#   ./scripts/install-scheduler.sh          # Install and start
#   ./scripts/install-scheduler.sh --remove # Unload and remove

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.orchestrator.scheduler"
PLIST_SRC="$PROJECT_ROOT/config/$PLIST_NAME.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

if [[ "${1:-}" == "--remove" ]]; then
    echo "Stopping and removing scheduler daemon..."
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    rm -f "$PLIST_DST"
    echo "Removed $PLIST_DST"
    exit 0
fi

# Install
echo "Installing scheduler daemon..."
mkdir -p "$HOME/Library/LaunchAgents"
# Substitute actual paths so the plist works regardless of where the project lives
sed -e "s|\$HOME/orchestrator|$PROJECT_ROOT|g" \
    -e "s|\\\$HOME|$HOME|g" \
    "$PLIST_SRC" > "$PLIST_DST"

# Unload first in case it's already running
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

# Ensure log directory exists
mkdir -p "$HOME/.claude/orchestrator/logs"

echo "Scheduler daemon installed and started."
echo "  Plist: $PLIST_DST"
echo "  Logs:  $HOME/.claude/orchestrator/logs/orchestrator-scheduler.log"
echo "  Errors: $HOME/.claude/orchestrator/logs/orchestrator-scheduler.err"
echo ""
echo "To check status: launchctl list | grep orchestrator"
echo "To stop:  launchctl unload $PLIST_DST"
echo "To start: launchctl load $PLIST_DST"
echo "To remove: $0 --remove"
