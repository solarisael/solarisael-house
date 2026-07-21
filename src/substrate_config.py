"""Shared substrate path and PostgreSQL environment resolution.

The TypeScript callers launch these helpers from either Windows or WSL.  Keep
all path selection here so every helper agrees about the optional substrate:
an explicit ``--substrate-dir``/``SOLARISAEL_SUBSTRATE`` wins, otherwise the
canonical sibling ``house/substrate`` directory is used.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Mapping

PG_ENV_KEYS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE")
_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:[\\/]")


class SubstrateConfigError(ValueError):
    """Raised when an explicitly selected or default substrate is unusable."""


def windows_path_to_wsl(value: str | os.PathLike[str]) -> str:
    """Convert a Windows path for a POSIX/WSL Python process when necessary.

    ``wslpath`` is preferred because it handles UNC and mounted paths.  The
    drive-letter fallback keeps this deterministic in test environments and
    on minimal WSL installations where the command is unavailable.
    """
    raw = os.fspath(value)
    if os.name == "nt" or not _WINDOWS_DRIVE_RE.match(raw):
        return raw

    try:
        if shutil.which("wslpath"):
            converted = subprocess.run(
                ["wslpath", "-u", raw],
                check=True,
                capture_output=True,
                text=True,
                timeout=2,
            ).stdout.strip()
            if converted:
                return converted
    except (OSError, subprocess.SubprocessError):
        # The pure conversion below is sufficient for ordinary drive paths.
        pass

    drive = raw[0].lower()
    remainder = raw[2:].replace("\\", "/")
    return f"/mnt/{drive}{remainder}"


def _resolved_path(value: str | os.PathLike[str]) -> Path:
    converted = windows_path_to_wsl(value)
    return Path(converted).expanduser().resolve(strict=False)


def resolve_substrate_dir(
    room_dir: str | os.PathLike[str] | None = None,
    substrate_dir: str | os.PathLike[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Resolve and validate the substrate directory.

    An explicit ``substrate_dir`` (the CLI flag) takes precedence over
    ``SOLARISAEL_SUBSTRATE``.  A non-empty environment override is otherwise
    used.  If neither is supplied, the default is the sibling path used by
    the House layout: ``room_dir.parent / house / substrate``.

    Invalid explicit configuration never silently falls back to the default;
    callers that have a fail-open contract can catch ``SubstrateConfigError``.
    """
    env = os.environ if environ is None else environ
    configured = substrate_dir
    source = "--substrate-dir"
    if configured is None and "SOLARISAEL_SUBSTRATE" in env:
        configured = env["SOLARISAEL_SUBSTRATE"]
        source = "SOLARISAEL_SUBSTRATE"

    if configured is not None:
        raw = os.fspath(configured).strip()
        if not raw:
            raise SubstrateConfigError(f"{source} must name a substrate directory")
        resolved = _resolved_path(raw)
    else:
        if room_dir is None:
            raise SubstrateConfigError(
                "room_dir is required when SOLARISAEL_SUBSTRATE is not configured"
            )
        room = _resolved_path(room_dir)
        resolved = (room.parent / "house" / "substrate").resolve(strict=False)

    if not resolved.is_dir():
        raise SubstrateConfigError(
            f"substrate directory does not exist or is not a directory: {resolved}"
        )
    return resolved


def read_env_file(path: str | os.PathLike[str]) -> dict[str, str]:
    """Read simple KEY=VALUE entries from a substrate ``.env`` file."""
    env_path = Path(path)
    values: dict[str, str] = {}
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def load_postgres_env(substrate_dir: str | os.PathLike[str]) -> dict[str, str]:
    """Load substrate ``.env`` values and overlay process PostgreSQL values."""
    values = read_env_file(Path(substrate_dir) / ".env")
    for key in PG_ENV_KEYS:
        value = os.environ.get(key)
        if value:
            values[key] = value
    return values


def substrate_env(
    room_dir: str | os.PathLike[str] | None = None,
    substrate_dir: str | os.PathLike[str] | None = None,
) -> dict[str, str]:
    """Compatibility helper returning the resolved PostgreSQL environment."""
    return load_postgres_env(resolve_substrate_dir(room_dir, substrate_dir))


# Short aliases for callers that prefer the noun used in the install contract.
resolve_substrate = resolve_substrate_dir
postgres_env = load_postgres_env

__all__ = [
    "PG_ENV_KEYS",
    "SubstrateConfigError",
    "load_postgres_env",
    "postgres_env",
    "read_env_file",
    "resolve_substrate",
    "resolve_substrate_dir",
    "substrate_env",
    "windows_path_to_wsl",
]
