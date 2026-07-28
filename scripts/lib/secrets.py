"""Credential lookup for adapters.

The scheduler runs under launchd, which does not source a login shell, so an
`export` in a shell profile is invisible to it. Credentials are therefore read
from the process environment first and from an optional dotenv file second.
"""

import os
import re
from pathlib import Path


ENV_FILE = Path.home() / ".claude" / "orchestrator" / ".env"

_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$")

_cache: dict[str, str] | None = None


def _load_env_file() -> dict[str, str]:
    global _cache
    if _cache is not None:
        return _cache

    values: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.lstrip().startswith("#"):
                continue
            match = _LINE_RE.match(line)
            if not match:
                continue
            value = match.group(2).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[match.group(1)] = value

    _cache = values
    return values


def get(name: str, default: str = "") -> str:
    """Read a credential from the environment, falling back to the dotenv file."""
    value = os.environ.get(name, "").strip()
    if value:
        return value
    return _load_env_file().get(name, default).strip() or default
