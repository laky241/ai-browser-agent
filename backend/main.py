import asyncio
import json
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from browser import BrowserController
from agent import BrowsingAgent

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks = {}

class TaskRequest(BaseModel):
    task: str

@app.get("/")
async def root():
    return {"status": "AI Browser Agent API is running"}

@app.post("/task")
async def create_task(request: TaskRequest):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "id": task_id,
        "task": request.task,
        "status": "pending",
        "steps": [],
        "result": None
    }
    return {"task_id": task_id}

@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()

    if task_id not in tasks:
        await websocket.send_json({"type": "error", "message": "Task not found"})
        await websocket.close()
        return

    task_data = tasks[task_id]
    task_data["status"] = "running"

    browser = BrowserController()
    agent = BrowsingAgent()

    try:
        await browser.start()

        await websocket.send_json({
            "type": "status",
            "message": "Browser started, agent running..."
        })

        async def on_step(step_data):
            screenshot = step_data["screenshot"]
            action = step_data["action"]
            step_num = step_data["step"]
            url = step_data["url"]

            task_data["steps"].append({
                "step": step_num,
                "action": action,
                "url": url
            })

            await websocket.send_json({
                "type": "step",
                "step": step_num,
                "action": action,
                "url": url,
                "screenshot": screenshot
            })

        result = await agent.run_task(
            task_data["task"],
            browser,
            on_step=on_step
        )

        task_data["status"] = "completed"
        task_data["result"] = result

        await websocket.send_json({
            "type": "done",
            "result": result
        })

    except WebSocketDisconnect:
        print(f"Client disconnected for task {task_id}")

    except Exception as e:
        task_data["status"] = "failed"
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })

    finally:
        await browser.stop()
        await websocket.close()

@app.get("/task/{task_id}")
async def get_task(task_id: str):
    if task_id not in tasks:
        return {"error": "Task not found"}
    return tasks[task_id]