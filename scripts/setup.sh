#!/usr/bin/env bash
# First-time setup for the orchestrator.
# Validates prerequisites, creates required directories and files,
# and optionally installs the scheduler.
#
# Usage:
#   ./scripts/setup.sh [--install-scheduler]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG="$PROJECT_ROOT/config/environment.yml"

INSTALL_SCHEDULER=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --install-scheduler) INSTALL_SCHEDULER=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

echo "=== Orchestrator Setup ==="
echo ""

ERRORS=0

# 1. Check config exists
if [[ ! -f "$CONFIG" ]]; then
    echo "FATAL: Config file not found: $CONFIG"
    exit 1
fi
echo "[ok] Config file found"

# 2. Parse config values
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
PROFILE_FILE="$CONFIG_PROFILE_FILE"
VMUX="$CONFIG_TOOL_VMUX"
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
GRAPHITE="$CONFIG_TOOL_GRAPHITE"
REPO_PATH="$CONFIG_REPO_PATH"

# 3. Check prerequisites
echo ""
echo "--- Prerequisites ---"

if [[ -x "$VMUX" ]]; then
    echo "[ok] vmux: $VMUX"
else
    echo "[MISSING] vmux not found at $VMUX"
    ERRORS=$((ERRORS + 1))
fi

if [[ -x "$ROSTRUM" ]]; then
    echo "[ok] rostrum: $ROSTRUM"
else
    echo "[MISSING] rostrum not found at $ROSTRUM"
    ERRORS=$((ERRORS + 1))
fi

if command -v "$GRAPHITE" >/dev/null 2>&1; then
    echo "[ok] graphite (gt): $(command -v "$GRAPHITE")"
else
    echo "[warn] graphite (gt) not in PATH — optional, for stacked PRs"
fi

if command -v python3 >/dev/null 2>&1; then
    echo "[ok] python3: $(command -v python3)"
else
    echo "[MISSING] python3 not found"
    ERRORS=$((ERRORS + 1))
fi

if command -v claude >/dev/null 2>&1; then
    echo "[ok] claude: $(command -v claude)"
else
    echo "[MISSING] claude CLI not found"
    ERRORS=$((ERRORS + 1))
fi

if [[ -d "$REPO_PATH" ]]; then
    echo "[ok] Main repo: $REPO_PATH"
else
    echo "[MISSING] Main repo not found at $REPO_PATH"
    ERRORS=$((ERRORS + 1))
fi

# 4. Create required directories and files
echo ""
echo "--- State Files ---"

QUEUE_DIR="$(dirname "$QUEUE_FILE")"
mkdir -p "$QUEUE_DIR"
echo "[ok] Directory: $QUEUE_DIR"

mkdir -p "$QUEUE_DIR/delegators"
echo "[ok] Directory: $QUEUE_DIR/delegators"

mkdir -p "$QUEUE_DIR/archive"
echo "[ok] Directory: $QUEUE_DIR/archive"

if [[ ! -f "$QUEUE_FILE" ]]; then
    echo '{"items":[]}' > "$QUEUE_FILE"
    echo "[created] Queue file: $QUEUE_FILE"
else
    echo "[ok] Queue file exists: $QUEUE_FILE"
fi

if [[ ! -f "$PROFILE_FILE" ]]; then
    echo "[warn] Profile not found: $PROFILE_FILE"
    echo "  Run: python3 $PROJECT_ROOT/scripts/preseed-profile.py"
else
    echo "[ok] Profile exists: $PROFILE_FILE"
fi

EVENTS_FILE="$QUEUE_DIR/events.jsonl"
if [[ ! -f "$EVENTS_FILE" ]]; then
    touch "$EVENTS_FILE"
    echo "[created] Events log: $EVENTS_FILE"
else
    echo "[ok] Events log exists: $EVENTS_FILE"
fi

# 5. Make scripts executable
echo ""
echo "--- Scripts ---"
chmod +x "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/*.py 2>/dev/null || true
echo "[ok] All scripts marked executable"

# 6. Install dashboard dependencies
if [[ ! -d "$PROJECT_ROOT/dashboard/node_modules" ]]; then
    echo ""
    echo "--- Dashboard Dependencies ---"
    echo "Installing npm dependencies..."
    cd "$PROJECT_ROOT/dashboard" && npm install
    echo "[ok] Dashboard dependencies installed"
else
    echo "[ok] Dashboard dependencies already installed"
fi

# 7. Optionally install scheduler
if [[ "$INSTALL_SCHEDULER" == "true" ]]; then
    echo ""
    echo "--- Scheduler ---"
    "$SCRIPT_DIR/install-scheduler.sh"
fi

# Summary
echo ""
echo "=== Setup Complete ==="
if [[ "$ERRORS" -gt 0 ]]; then
    echo "$ERRORS prerequisite(s) missing — fix them before running the orchestrator."
    exit 1
else
    echo "All prerequisites met. Start the dashboard with:"
    echo "  cd $PROJECT_ROOT/dashboard && npm run dev"
fi
