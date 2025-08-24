# HomeCam

HomeCam is a lightweight home camera surveillance backend implemented with FastAPI and `ffmpeg`. It records RTSP camera streams, keeps per-camera retention policies, and exposes a simple API for configuration.

## Requirements
- Python 3.11+
- `ffmpeg` available on the system `PATH`

## Installation
Install the Python dependencies:

```bash
pip install fastapi pydantic uvicorn websockets
```

## Running the API server
Start the FastAPI application with `uvicorn`:

```bash
uvicorn homecam.backend.main:app --reload
```

The API will be available at http://localhost:8000.

To run on a different port, provide the `--port` option. For example, to listen on port
`9000`:

```bash
uvicorn homecam.backend.main:app --reload --port 9000
```

## Example usage
### Add a camera
```bash
curl -X POST http://localhost:8000/cameras \
  -H "Content-Type: application/json" \
  -d '{
        "id": "front",
        "name": "Front Door",
        "rtsp_url": "rtsp://example/stream",
        "storage_path": "./recordings/front",
        "retention_days": 7
      }'
```

### List cameras
```bash
curl http://localhost:8000/cameras
```

### Remove a camera
```bash
curl -X DELETE http://localhost:8000/cameras/front
```

### Live streams
After adding a camera, low- and high-quality HLS playlists are available:

- `http://localhost:8000/streams/<camera_id>/low/index.m3u8`
- `http://localhost:8000/streams/<camera_id>/high/index.m3u8`

Use a player such as [hls.js](https://github.com/video-dev/hls.js/) in the frontend to view these streams.

The playlist files are created immediately, but it may take a few seconds after adding a
camera for `ffmpeg` to begin writing segments. If the playlist contains only `#EXTM3U`,
wait briefly and try again to allow the stream to start.

## Manual testing
1. **Verify recording** – After adding a camera, check that the configured `storage_path` contains timestamped `.mp4` files created by `ffmpeg`.
2. **Verify live streams** – Fetch the HLS playlist for a camera:
   ```bash
   curl http://localhost:8000/streams/front/low/index.m3u8
   ```
3. **Verify retention** – Run the cleanup utility to remove recordings older than the retention period:
   ```bash
   python - <<'PY'
from pathlib import Path
from homecam.backend.retention import cleanup_old_recordings
cleanup_old_recordings(Path('./recordings/front'), retention_days=7)
PY
   ```
4. **Run unit tests** – Execute the pytest suite:
   ```bash
   python -m pytest -q
   ```

These steps ensure that the API endpoints work, recordings are written, and old footage is pruned according to your retention policy.
