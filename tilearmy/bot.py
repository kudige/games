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


async def bot_player(
    base_url: str, name: str, interval: float = 5, verbose: bool = False
) -> None:
    """Join the game server and periodically spawn scout vehicles.

    Parameters
    ----------
    base_url: str
        Base websocket or http URL for the game server.
    name: str
        Player name for this bot.
    interval: float, optional
        Delay between spawn commands in seconds. Defaults to 5 seconds.
        This is primarily exposed for testing so the interval can be
        shortened without affecting normal behaviour.
    verbose: bool, optional
        If ``True``, print actions and resource counts to stdout.
    """

    ws_url = build_ws_url(base_url, name)
    async with websockets.connect(ws_url) as ws:
        if verbose:
            print(f"[{name}] connected to {ws_url}")
        init = json.loads(await ws.recv())
        if init.get("type") != "init":
            return
        player = init["state"]["players"][name]
        base_id = player["bases"][0]
        resources = {k: player.get(k, 0) for k in ("ore", "lumber", "stone")}

        async def receiver():
            async for msg in ws:
                data = json.loads(msg)
                if data.get("type") == "state":
                    me = data.get("players", {}).get(name)
                    if me:
                        for k in resources:
                            resources[k] = me.get(k, resources[k])
                elif data.get("type") == "update":
                    for ent in data.get("entities", []):
                        if ent.get("kind") == "player" and ent.get("id") == name:
                            for k in resources:
                                resources[k] = ent.get(k, resources[k])
                if verbose:
                    print(f"[{name}] <- {data}")

        async def spawner():
            while True:
                await ws.send(
                    json.dumps(
                        {"type": "spawnVehicle", "baseId": base_id, "vType": "scout"}
                    )
                )
                if verbose:
                    print(
                        f"[{name}] -> spawn scout | ore={resources['ore']} lumber={resources['lumber']} stone={resources['stone']}"
                    )
                await asyncio.sleep(interval)

        await asyncio.gather(receiver(), spawner())


def main():
    parser = argparse.ArgumentParser(description="TileArmy simple bot swarm")
    parser.add_argument("url", help="Game server URL, e.g. ws://localhost:3000/")
    parser.add_argument(
        "count", type=int, help="Number of bot players to spawn"
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Print bot actions and resource counts",
    )
    args = parser.parse_args()

    async def run():
        tasks = [
            asyncio.create_task(
                bot_player(
                    args.url, f"bot-{i}-{uuid.uuid4().hex[:4]}", verbose=args.verbose
                )
            )
            for i in range(args.count)
        ]
        await asyncio.gather(*tasks)

    asyncio.run(run())


if __name__ == "__main__":
    main()
