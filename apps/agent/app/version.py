# apps/agent/app/version.py
from __future__ import annotations
import pathlib
import tomllib

def _read() -> str:
    try:
        p = pathlib.Path(__file__).parent.parent / "pyproject.toml"
        with open(p, "rb") as f:
            return tomllib.load(f)["project"]["version"]
    except Exception:
        return "unknown"

APP_VERSION = _read()
