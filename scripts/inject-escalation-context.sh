#!/usr/bin/env bash
# Inject triage escalation context into a cycle payload for Opus.
#
# Usage: inject-escalation-context.sh <cycle-json> <triage-output> <output-file>
#
# Reads the triage output, extracts escalation_context and reason,
# injects them into the cycle payload as triage_escalation, and writes the result.

set -euo pipefail

CYCLE_JSON="${1:?Usage: inject-escalation-context.sh <cycle-json> <triage-output> <output-file>}"
TRIAGE_OUTPUT="${2:?Missing triage output file}"
OUTPUT_FILE="${3:?Missing output file path}"

python3 - "$CYCLE_JSON" "$TRIAGE_OUTPUT" "$OUTPUT_FILE" << 'PYEOF'
import json, sys, re

def try_parse(text):
    cleaned = re.sub(r',\s*([}\]])', r'\1', text)
    return json.loads(cleaned)

def extract_json(raw):
    raw = raw.strip()
    fence = chr(96) * 3
    nl = chr(10)
    for m in re.finditer(fence + r'json\s*' + nl + '(.*?)' + nl + fence, raw, re.DOTALL):
        try:
            return try_parse(m.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            continue
    for m in re.finditer(fence + '[^' + nl + ']*' + nl + '(.*?)' + nl + fence, raw, re.DOTALL):
        try:
            return try_parse(m.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            continue
    try:
        return try_parse(raw)
    except (json.JSONDecodeError, ValueError):
        pass
    bm = re.search(r'\{.*\}', raw, re.DOTALL)
    if bm:
        try:
            return try_parse(bm.group(0))
        except (json.JSONDecodeError, ValueError):
            pass
    return {}

cycle_path, triage_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

with open(cycle_path) as f:
    cycle = json.load(f)

with open(triage_path) as f:
    triage_text = f.read()

triage_data = extract_json(triage_text) or {}
esc_ctx = triage_data.get('escalation_context', '')
esc_reason = triage_data.get('reason', '')

if esc_ctx or esc_reason:
    cycle['triage_escalation'] = {
        'reason': esc_reason,
        'context': esc_ctx,
    }

with open(output_path, 'w') as f:
    json.dump(cycle, f, indent=2)
PYEOF
