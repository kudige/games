from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from .recorder import Recorder


@dataclass
class CameraConfig:
    """Configuration for a single camera."""

    id: str
    name: str
    rtsp_url: str
    storage_path: Path
    retention_days: int

    def to_dict(self) -> Dict[str, Any]:
        """Serialize config including stream URLs."""
        return {
            "id": self.id,
            "name": self.name,
            "rtsp_url": self.rtsp_url,
            "storage_path": str(self.storage_path),
            "retention_days": self.retention_days,
            "stream_urls": {
                "low": f"/streams/{self.id}/low/index.m3u8",
                "high": f"/streams/{self.id}/high/index.m3u8",
            },
        }


class CameraManager:
    """Manage camera configurations and recording processes."""

    def __init__(self, config_file: Path):
        self.config_file = config_file
        self.cameras: Dict[str, CameraConfig] = {}
        self.recorders: Dict[str, Recorder] = {}
        if self.config_file.exists():
            self._load()
            for cam in self.cameras.values():
                rec = Recorder(cam)
                rec.start()
                self.recorders[cam.id] = rec

    # ------------------------------------------------------------------
    # Configuration persistence
    # ------------------------------------------------------------------
    def _load(self) -> None:
        data = json.loads(self.config_file.read_text())
        for cid, cfg in data.items():
            self.cameras[cid] = CameraConfig(
                id=cid,
                name=cfg["name"],
                rtsp_url=cfg["rtsp_url"],
                storage_path=Path(cfg["storage_path"]),
                retention_days=cfg["retention_days"],
            )

    def _save(self) -> None:
        data = {
            cid: {
                "name": c.name,
                "rtsp_url": c.rtsp_url,
                "storage_path": str(c.storage_path),
                "retention_days": c.retention_days,
            }
            for cid, c in self.cameras.items()
        }
        self.config_file.write_text(json.dumps(data, indent=2))

    # ------------------------------------------------------------------
    # Camera management
    # ------------------------------------------------------------------
    def add_camera(self, camera: CameraConfig) -> None:
        """Register a camera and start recording."""
        self.cameras[camera.id] = camera
        self._save()
        recorder = Recorder(camera)
        recorder.start()
        self.recorders[camera.id] = recorder

    def remove_camera(self, camera_id: str) -> None:
        """Stop recording and remove camera from registry."""
        recorder = self.recorders.pop(camera_id, None)
        if recorder:
            recorder.stop()
        self.cameras.pop(camera_id, None)
        self._save()

    def list_cameras(self) -> Dict[str, CameraConfig]:
        """Return a mapping of camera IDs to configs."""
        return self.cameras
