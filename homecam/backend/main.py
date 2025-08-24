from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .camera_manager import CameraConfig, CameraManager
from .recorder import Recorder

if os.environ.get("HOMECAM_TESTING"):
    def _noop(self):
        return None
    Recorder.start = _noop  # type: ignore

DEFAULT_STORAGE = Path("recordings")
DEFAULT_STORAGE.mkdir(exist_ok=True)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="HomeCam API")
manager = CameraManager(Path("camera_config.json"))


class CameraIn(BaseModel):
    id: str
    name: str
    rtsp_url: str
    storage_path: str | None = None
    retention_days: int


@app.post("/cameras")
def add_camera(camera: CameraIn) -> dict[str, str]:
    storage = Path(camera.storage_path) if camera.storage_path else DEFAULT_STORAGE / camera.id
    config = CameraConfig(
        id=camera.id,
        name=camera.name,
        rtsp_url=camera.rtsp_url,
        storage_path=storage,
        retention_days=camera.retention_days,
    )
    manager.add_camera(config)
    return {"status": "added"}


@app.get("/cameras")
def list_cameras() -> list[dict]:
    return [c.to_dict() for c in manager.list_cameras().values()]


@app.delete("/cameras/{camera_id}")
def delete_camera(camera_id: str) -> dict[str, str]:
    if camera_id not in manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager.remove_camera(camera_id)
    return {"status": "removed"}


@app.get("/defaults")
def defaults() -> dict[str, str]:
    return {"storage_path": str(DEFAULT_STORAGE)}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/manage")
def manage_page() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "manage.html")


@app.get("/streams/{camera_id}/{quality}/{filename:path}")
def stream_file(camera_id: str, quality: str, filename: str):
    if camera_id not in manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
    if quality not in {"low", "high"}:
        raise HTTPException(status_code=404, detail="Invalid quality")
    base = Path(manager.cameras[camera_id].storage_path) / "streams" / quality
    file_path = base / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)
