import json
from pathlib import Path

from homecam.backend.camera_manager import CameraManager
from homecam.backend.recorder import Recorder


def test_manager_starts_recorders_on_init(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    storage = tmp_path / "storage"
    config = {
        "cam1": {
            "name": "Cam 1",
            "rtsp_url": "rtsp://example",
            "storage_path": str(storage),
            "retention_days": 1,
        }
    }
    config_file.write_text(json.dumps(config))

    started = []

    def fake_start(self):
        started.append(self.camera.id)

    monkeypatch.setattr(Recorder, "start", fake_start)

    manager = CameraManager(config_file)

    assert "cam1" in manager.recorders
    assert started == ["cam1"]
