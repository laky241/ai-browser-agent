import asyncio
import json
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from browser import BrowserController
from agent import BrowsingAgent
from database import create_task, update_task, get_task, get_all_tasks, get_or_create_user
from auth import get_google_auth_url, get_google_user, create_access_token, decode_access_token

REDIRECT_URI = "http://localhost:8000/auth/callback"
FRONTEND_URL = "http://localhost:5173"

limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_current_user(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        token = request.cookies.get("token", "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload

class TaskRequest(BaseModel):
    task: str

@app.get("/")
async def root():
    return {"status": "AI Browser Agent API is running"}

@app.get("/auth/login")
async def login():
    url = get_google_auth_url(REDIRECT_URI)
    return {"url": url}

@app.get("/auth/callback")
async def auth_callback(code: str):
    user_info = await get_google_user(code, REDIRECT_URI)
    user_id = str(uuid.uuid4())
    user = get_or_create_user(
        user_id=user_id,
        email=user_info["email"],
        name=user_info.get("name", ""),
        picture=user_info.get("picture", "")
    )
    token = create_access_token({
        "sub": user["email"],
        "name": user["name"],
        "picture": user["picture"],
        "id": user["id"]
    })
    response = RedirectResponse(url=f"{FRONTEND_URL}?token={token}")
    return response

@app.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return user

@app.get("/tasks")
async def list_tasks(user=Depends(get_current_user)):
    return get_all_tasks()

@app.post("/task")
@limiter.limit("50/hour")
async def create_new_task(request: Request, body: TaskRequest, user=Depends(get_current_user)):
    if not body.task.strip():
        return JSONResponse(status_code=400, content={"error": "Task cannot be empty"})
    if len(body.task.strip()) < 5:
        return JSONResponse(status_code=400, content={"error": "Task too short"})
    task_id = str(uuid.uuid4())
    create_task(task_id, body.task.strip())
    return {"task_id": task_id}

@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()

    task_data = get_task(task_id)
    if not task_data:
        await websocket.send_json({"type": "error", "message": "Task not found"})
        await websocket.close()
        return

    update_task(task_id, status="running")
    steps = []
    browser = BrowserController()
    agent = BrowsingAgent()

    try:
        await browser.start()

        initial_screenshot = await browser.screenshot_base64()
        await websocket.send_json({
            "type": "step",
            "step": 0,
            "action": {"action": "start"},
            "url": "about:blank",
            "screenshot": initial_screenshot
        })

        await websocket.send_json({
            "type": "status",
            "message": "Browser started, agent running..."
        })

        async def on_step(step_data):
            step_entry = {
                "step": step_data["step"],
                "action": step_data["action"],
                "url": step_data["url"]
            }
            steps.append(step_entry)
            update_task(task_id, steps=steps)
            await websocket.send_json({
                "type": "step",
                "step": step_data["step"],
                "action": step_data["action"],
                "url": step_data["url"],
                "screenshot": step_data["screenshot"]
            })

        result = await agent.run_task(task_data["task"], browser, on_step=on_step)
        update_task(task_id, status="completed", result=result)
        await websocket.send_json({"type": "done", "result": result})

    except WebSocketDisconnect:
        update_task(task_id, status="disconnected")

    except Exception as e:
        update_task(task_id, status="failed")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass

    finally:
        await browser.stop()
        try:
            await websocket.close()
        except:
            pass

@app.get("/task/{task_id}")
async def get_single_task(task_id: str):
    task = get_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return task