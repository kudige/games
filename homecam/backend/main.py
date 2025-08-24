from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .camera_manager import CameraConfig, CameraManager

app = FastAPI(title="HomeCam API")
manager = CameraManager(Path("camera_config.json"))


class CameraIn(BaseModel):
    id: str
    name: str
    rtsp_url: str
    storage_path: str
    retention_days: int


@app.post("/cameras")
def add_camera(camera: CameraIn) -> dict[str, str]:
    config = CameraConfig(
        id=camera.id,
        name=camera.name,
        rtsp_url=camera.rtsp_url,
        storage_path=Path(camera.storage_path),
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
