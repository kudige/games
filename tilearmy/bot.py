import argparse
import asyncio
import json
import uuid
from urllib.parse import urlparse

import websockets


def build_ws_url(base_url: str, name: str) -> str:
    """Convert http/https URLs to websocket and append player name."""
    parsed = urlparse(base_url)
    if parsed.scheme.startswith("http"):
        scheme = "ws" if parsed.scheme == "http" else "wss"
        netloc = parsed.netloc
        path = parsed.path or "/"
        base = f"{scheme}://{netloc}{path}"
    else:
        base = base_url
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}name={name}"


async def bot_player(base_url: str, name: str):
    ws_url = build_ws_url(base_url, name)
    async with websockets.connect(ws_url) as ws:
        init = json.loads(await ws.recv())
        if init.get("type") != "init":
            return
        player = init["state"]["players"][name]
        base_id = player["bases"][0]

        async def receiver():
            async for _ in ws:
                pass  # ignore all incoming messages

        async def spawner():
            while True:
                await ws.send(
                    json.dumps(
                        {"type": "spawnVehicle", "baseId": base_id, "vType": "scout"}
                    )
                )
                await asyncio.sleep(5)

        await asyncio.gather(receiver(), spawner())


def main():
    parser = argparse.ArgumentParser(description="TileArmy simple bot swarm")
    parser.add_argument("url", help="Game server URL, e.g. ws://localhost:3000/")
    parser.add_argument(
        "count", type=int, help="Number of bot players to spawn"
    )
    args = parser.parse_args()

    async def run():
        tasks = [
            asyncio.create_task(bot_player(args.url, f"bot-{i}-{uuid.uuid4().hex[:4]}"))
            for i in range(args.count)
        ]
        await asyncio.gather(*tasks)

    asyncio.run(run())


if __name__ == "__main__":
    main()
