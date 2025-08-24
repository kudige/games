from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable


def cleanup_old_recordings(directory: Path, retention_days: int) -> Iterable[Path]:
    """Remove files older than ``retention_days`` and yield removed paths."""
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    removed: list[Path] = []
    for entry in directory.glob("*.mp4"):
        mtime = datetime.utcfromtimestamp(entry.stat().st_mtime)
        if mtime < cutoff:
            entry.unlink(missing_ok=True)
            removed.append(entry)
    return removed
