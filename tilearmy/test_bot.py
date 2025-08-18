import asyncio
import json
import unittest
from io import StringIO
from contextlib import redirect_stdout
from urllib.parse import parse_qs, urlparse

import websockets

from tilearmy.bot import build_ws_url, bot_player


class BuildWsUrlTests(unittest.TestCase):
    def test_http_and_https_conversion(self):
        self.assertEqual(
            build_ws_url("http://example.com", "foo"),
            "ws://example.com/?name=foo",
        )
        self.assertEqual(
            build_ws_url("https://example.com/play", "bar"),
            "wss://example.com/play?name=bar",
        )

    def test_existing_query(self):
        self.assertEqual(
            build_ws_url("ws://localhost:3000/?foo=bar", "baz"),
            "ws://localhost:3000/?foo=bar&name=baz",
        )


class BotPlayerTests(unittest.TestCase):
    def test_bot_player_spawns(self):
        received = []

        async def handler(ws):
            query = parse_qs(urlparse(ws.request.path).query)
            name = query["name"][0]
            await ws.send(
                json.dumps(
                    {"type": "init", "state": {"players": {name: {"bases": [1]}}}}
                )
            )
            for _ in range(2):
                try:
                    received.append(json.loads(await ws.recv()))
                except websockets.ConnectionClosed:
                    break
            await ws.wait_closed()

        async def run():
            async with websockets.serve(handler, "localhost", 0) as server:
                port = server.sockets[0].getsockname()[1]
                task = asyncio.create_task(
                    bot_player(f"ws://localhost:{port}/", "tester", interval=0.01)
                )
                await asyncio.sleep(0.05)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        asyncio.run(run())
        self.assertGreaterEqual(len(received), 2)
        self.assertEqual(
            received[0],
            {"type": "spawnVehicle", "baseId": 1, "vType": "scout"},
        )

    def test_bot_player_verbose_logs(self):
        output = StringIO()

        async def handler(ws):
            query = parse_qs(urlparse(ws.request.path).query)
            name = query["name"][0]
            await ws.send(
                json.dumps(
                    {
                        "type": "init",
                        "state": {
                            "players": {name: {"bases": [1], "ore": 10, "lumber": 5, "stone": 2}}
                        },
                    }
                )
            )
            await ws.recv()
            await ws.send(
                json.dumps(
                    {
                        "type": "update",
                        "entities": [
                            {"kind": "player", "id": name, "ore": 12},
                            {
                                "kind": "vehicle",
                                "id": 1,
                                "owner": name,
                                "x": 3,
                            },
                        ],
                    }
                )
            )
            await asyncio.sleep(0.01)
            await ws.wait_closed()

        async def run():
            async with websockets.serve(handler, "localhost", 0) as server:
                port = server.sockets[0].getsockname()[1]
                with redirect_stdout(output):
                    task = asyncio.create_task(
                        bot_player(
                            f"ws://localhost:{port}/",
                            "tester",
                            interval=0.01,
                            verbose=True,
                        )
                    )
                    await asyncio.sleep(0.05)
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass

        asyncio.run(run())
        logged = output.getvalue()
        self.assertIn("spawn scout", logged)
        self.assertIn("ore=10", logged)
        self.assertIn("[tester] update:", logged)
        self.assertIn("player tester: ore=12", logged)
        self.assertIn("vehicle 1: owner=tester, x=3", logged)

    def test_bot_player_handles_large_messages(self):
        async def handler(ws):
            query = parse_qs(urlparse(ws.request.path).query)
            name = query["name"][0]
            await ws.send(
                json.dumps(
                    {"type": "init", "state": {"players": {name: {"bases": [1]}}}}
                )
            )
            await ws.recv()
            big_payload = {
                "type": "state",
                "players": {},
                "pad": "x" * (1024 * 1024 + 10),
            }
            await ws.send(json.dumps(big_payload))
            await asyncio.sleep(0.01)
            await ws.wait_closed()

        async def run():
            async with websockets.serve(handler, "localhost", 0) as server:
                port = server.sockets[0].getsockname()[1]
                task = asyncio.create_task(
                    bot_player(f"ws://localhost:{port}/", "tester", interval=0.01)
                )
                await asyncio.sleep(0.05)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
