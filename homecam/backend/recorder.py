from __future__ import annotations

import subprocess
from datetime import datetime
from pathlib import Path


class Recorder:
    """Spawn an ffmpeg process to record a camera stream."""

    def __init__(self, camera: "CameraConfig"):
        self.camera = camera
        self.process: subprocess.Popen | None = None

    def start(self) -> None:
        output_dir = Path(self.camera.storage_path)
        output_dir.mkdir(parents=True, exist_ok=True)
        filename = datetime.utcnow().strftime("%Y%m%d_%H%M%S.mp4")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            self.camera.rtsp_url,
            "-c",
            "copy",
            str(output_dir / filename),
        ]
        self.process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait()
        self.process = None
