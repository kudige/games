from pathlib import Path

from fastapi.testclient import TestClient

from homecam.backend.camera_manager import CameraConfig
from homecam.backend.recorder import Recorder
from homecam.backend import main


def test_ffmpeg_command_has_hls_outputs(tmp_path: Path):
    cam = CameraConfig(
        id="cam",
        name="Cam",
        rtsp_url="rtsp://example",
        storage_path=tmp_path,
        retention_days=1,
    )
    rec = Recorder(cam)
    cmd = rec._build_ffmpeg_cmd(
        tmp_path / "out.mp4",
        tmp_path / "streams/low/index.m3u8",
        tmp_path / "streams/high/index.m3u8",
    )
    assert "-rtsp_transport" in cmd
    assert "tcp" in cmd
    assert str(tmp_path / "out.mp4") in cmd
    assert str(tmp_path / "streams/low/index.m3u8") in cmd
    assert str(tmp_path / "streams/high/index.m3u8") in cmd
    assert cmd.count("hls") == 2


def test_stream_endpoint_serves_playlist(tmp_path: Path):
    cid = "cam1"
    storage = tmp_path / cid
    playlist = storage / "streams" / "low" / "index.m3u8"
    playlist.parent.mkdir(parents=True, exist_ok=True)
    playlist.write_text("#EXTM3U")

    cam = CameraConfig(
        id=cid,
        name="Test",
        rtsp_url="rtsp://example",
        storage_path=storage,
        retention_days=1,
    )
    main.manager.cameras[cid] = cam
    client = TestClient(main.app)
    try:
        resp = client.get(f"/streams/{cid}/low/index.m3u8")
        assert resp.status_code == 200
        assert resp.text.startswith("#EXTM3U")
    finally:
        main.manager.cameras.pop(cid, None)
