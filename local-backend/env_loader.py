"""Load API keys from local-backend/.env and process environment."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_ENV_LOADED = False


def load_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    _ENV_LOADED = True


def get_key(*names: str) -> str | None:
    load_env()
    for name in names:
        val = os.environ.get(name, "").strip()
        if val:
            return val
    return None