from __future__ import annotations

import subprocess
from datetime import datetime
from pathlib import Path
from typing import List


class Recorder:
    """Spawn an ffmpeg process to record a camera stream."""

    def __init__(self, camera: "CameraConfig"):
        self.camera = camera
        self.process: subprocess.Popen | None = None

    def _build_ffmpeg_cmd(
        self, record_path: Path, low_playlist: Path, high_playlist: Path
    ) -> List[str]:
        """Build ffmpeg command for recording and HLS streaming."""

        return [
            "ffmpeg",
            "-y",
            "-i",
            self.camera.rtsp_url,
            # Full-quality recording
            "-map",
            "0",
            "-c",
            "copy",
            str(record_path),
            # Low-bandwidth stream
            "-map",
            "0",
            "-vf",
            "scale=640:-2",
            "-c:v",
            "libx264",
            "-b:v",
            "500k",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "3",
            str(low_playlist),
            # High-resolution stream
            "-map",
            "0",
            "-c:v",
            "libx264",
            "-b:v",
            "3000k",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "3",
            str(high_playlist),
        ]

    def start(self) -> None:
        record_dir = Path(self.camera.storage_path)
        low_dir = record_dir / "streams" / "low"
        high_dir = record_dir / "streams" / "high"
        for d in (record_dir, low_dir, high_dir):
            d.mkdir(parents=True, exist_ok=True)
        filename = datetime.utcnow().strftime("%Y%m%d_%H%M%S.mp4")
        record_path = record_dir / filename
        cmd = self._build_ffmpeg_cmd(
            record_path, low_dir / "index.m3u8", high_dir / "index.m3u8"
        )
        self.process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait()
        self.process = None
