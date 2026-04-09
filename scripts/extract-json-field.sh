#!/usr/bin/env bash
# Extract a field from a JSON file that may be wrapped in markdown code fences.
#
# Usage: extract-json-field.sh <file> <field> [default]
#
# Handles: code fences, trailing commas, leading/trailing prose, multiple blocks.
# Outputs the field value to stdout. Falls back to <default> on any error.

set -euo pipefail

FILE="${1:?Usage: extract-json-field.sh <file> <field> [default]}"
FIELD="${2:?Missing field name}"
DEFAULT="${3:-}"

python3 - "$FILE" "$FIELD" "$DEFAULT" << 'PYEOF'
import json, sys, re

def try_parse(text):
    """Parse JSON, stripping trailing commas first."""
    cleaned = re.sub(r',\s*([}\]])', r'\1', text)
    return json.loads(cleaned)

def extract_json(raw):
    """Extract a JSON object from text that may include markdown fences or prose."""
    raw = raw.strip()
    fence = chr(96) * 3
    nl = chr(10)

    # Strategy 1: json-tagged fence blocks
    for m in re.finditer(fence + r'json\s*' + nl + '(.*?)' + nl + fence, raw, re.DOTALL):
        try:
            return try_parse(m.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            continue

    # Strategy 2: any fence block
    for m in re.finditer(fence + '[^' + nl + ']*' + nl + '(.*?)' + nl + fence, raw, re.DOTALL):
        try:
            return try_parse(m.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            continue

    # Strategy 3: whole text as JSON
    try:
        return try_parse(raw)
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 4: first { ... } block
    bm = re.search(r'\{.*\}', raw, re.DOTALL)
    if bm:
        try:
            return try_parse(bm.group(0))
        except (json.JSONDecodeError, ValueError):
            pass

    return None

file_path, field, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(file_path) as f:
        text = f.read()
    data = extract_json(text)
    if data is not None:
        print(data.get(field, default))
    else:
        print(default)
except Exception:
    print(default)
PYEOF
