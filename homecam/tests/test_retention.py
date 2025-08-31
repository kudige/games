import os
from datetime import datetime, timedelta
from pathlib import Path

from homecam.backend.retention import cleanup_old_recordings


def test_cleanup_old_recordings(tmp_path: Path) -> None:
    old_file = tmp_path / "old.mp4"
    recent_file = tmp_path / "new.mp4"
    old_file.write_bytes(b"old")
    recent_file.write_bytes(b"new")

    old_time = datetime.utcnow() - timedelta(days=10)
    recent_time = datetime.utcnow() - timedelta(days=1)
    _set_mtime(old_file, old_time)
    _set_mtime(recent_file, recent_time)

    removed = cleanup_old_recordings(tmp_path, retention_days=5)

    assert old_file in removed
    assert not old_file.exists()
    assert recent_file.exists()
    assert recent_file not in removed


def _set_mtime(path: Path, dt: datetime) -> None:
    ts = dt.timestamp()
    os.utime(path, (ts, ts))
