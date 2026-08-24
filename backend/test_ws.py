import asyncio
import websockets
import json

async def test():
    uri = "ws://127.0.0.1:8000/ws/ask"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"question": "What was the moving average of MSFT from March to May 2024?", "session_id": "wstest"}))
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            print(data)
            if data["type"] == "final":
                break

asyncio.run(test())