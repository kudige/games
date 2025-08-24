from pathlib import Path

import os

os.environ["HOMECAM_TESTING"] = "1"

from fastapi.testclient import TestClient

from homecam.backend import main
from homecam.backend.recorder import Recorder


def test_defaults_endpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DEFAULT_STORAGE", tmp_path)
    client = TestClient(main.app)
    resp = client.get("/defaults")
    assert resp.status_code == 200
    assert resp.json()["storage_path"] == str(tmp_path)


def test_add_camera_uses_default_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DEFAULT_STORAGE", tmp_path)

    started = []

    def fake_start(self):
        started.append(self.camera.id)

    monkeypatch.setattr(Recorder, "start", fake_start)

    client = TestClient(main.app)
    payload = {
        "id": "cam1",
        "name": "Cam",
        "rtsp_url": "rtsp://example",
        "retention_days": 1,
    }
    resp = client.post("/cameras", json=payload)
    assert resp.status_code == 200
    assert main.manager.cameras["cam1"].storage_path == tmp_path / "cam1"
    assert started == ["cam1"]
    main.manager.remove_camera("cam1")
