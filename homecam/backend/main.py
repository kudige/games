from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
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
def list_cameras() -> dict[str, CameraConfig]:
    return manager.list_cameras()


@app.delete("/cameras/{camera_id}")
def delete_camera(camera_id: str) -> dict[str, str]:
    if camera_id not in manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager.remove_camera(camera_id)
    return {"status": "removed"}
