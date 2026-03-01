#!/usr/bin/env bash
# Shared environment validation for orchestrator scripts.
#
# Source this AFTER setting CONFIG and QUEUE_FILE:
#   source "$SCRIPT_DIR/validate-env.sh"
#
# It verifies that required files and tools exist before the script continues.
# Automatically creates the queue file directory and an empty queue if missing.

# Check config exists
if [[ ! -f "$CONFIG" ]]; then
    echo "ERROR: Config file not found: $CONFIG" >&2
    echo "  Run the setup script or verify your orchestrator installation." >&2
    exit 1
fi

# Ensure queue file directory exists and initialize queue if missing
QUEUE_DIR="$(dirname "$QUEUE_FILE")"
if [[ ! -d "$QUEUE_DIR" ]]; then
    mkdir -p "$QUEUE_DIR"
fi
if [[ ! -f "$QUEUE_FILE" ]]; then
    echo '{"items":[]}' > "$QUEUE_FILE"
    echo "Initialized empty queue at $QUEUE_FILE" >&2
fi

# Validate queue file is valid JSON
if ! python3 -c "import json; json.load(open('$QUEUE_FILE'))" 2>/dev/null; then
    echo "ERROR: Queue file is not valid JSON: $QUEUE_FILE" >&2
    exit 1
fi

# Check vmux is available (if VMUX var is set)
if [[ -n "${VMUX:-}" && ! -x "$VMUX" ]]; then
    echo "WARNING: vmux not found at $VMUX — session operations will fail" >&2
fi
