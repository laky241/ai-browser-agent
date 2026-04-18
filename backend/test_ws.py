import asyncio
import websockets
import json

async def test():
    task_id = "54adeb5c-f0c5-475f-becc-6b10be15a741"
    uri = f"ws://localhost:8000/ws/{task_id}"

    async with websockets.connect(uri) as ws:
        print("Connected to WebSocket!")
        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=120)
                data = json.loads(msg)
                msg_type = data.get("type")

                if msg_type == "status":
                    print(f"Status: {data['message']}")
                elif msg_type == "step":
                    print(f"Step {data['step']}: {data['action']} | URL: {data['url']}")
                elif msg_type == "done":
                    print(f"DONE! Result: {data['result']}")
                    break
                elif msg_type == "error":
                    print(f"Error: {data['message']}")
                    break
            except asyncio.TimeoutError:
                print("Timeout")
                break

asyncio.run(test())