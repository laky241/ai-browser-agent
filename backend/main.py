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
    allow_origins=[FRONTEND_URL],
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
    state = str(uuid.uuid4())
    url = get_google_auth_url(REDIRECT_URI, state)

    response = JSONResponse({"url": url})
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=600,
    )
    return response


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str, state: str):
    stored_state = request.cookies.get("oauth_state")

    if not stored_state or stored_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

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
        "email": user["email"],
        "name": user["name"],
        "picture": user["picture"],
        "id": user["id"]
    })

    response = RedirectResponse(url=f"{FRONTEND_URL}?token={token}")
    response.delete_cookie("oauth_state")
    return response


@app.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return user


@app.get("/tasks")
async def list_tasks(user=Depends(get_current_user)):
    return get_all_tasks(user["id"])


@app.post("/task")
@limiter.limit("50/hour")
async def create_new_task(request: Request, body: TaskRequest, user=Depends(get_current_user)):
    task_text = body.task.strip()

    if not task_text:
        return JSONResponse(status_code=400, content={"error": "Task cannot be empty"})

    if len(task_text) < 5:
        return JSONResponse(status_code=400, content={"error": "Task too short"})

    task_id = str(uuid.uuid4())
    create_task(task_id, user["id"], task_text)

    return {"task_id": task_id}


@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=1008)
        return

    user = decode_access_token(token)
    if not user:
        await websocket.close(code=1008)
        return

    task_data = get_task(task_id, user["id"])
    if not task_data:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    update_task(task_id, status="running")
    steps = []

    browser = BrowserController()
    agent = BrowsingAgent()

    try:
        print("WS: starting browser")
        await browser.start()

        print("WS: browser started")
        initial_screenshot = await browser.screenshot_base64()

        print("WS: screenshot captured")
        await websocket.send_json({
            "type": "step",
            "step": 0,
            "action": {"action": "start"},
            "url": "about:blank",
            "screenshot": initial_screenshot
        })
        print("WS: initial step sent")

        async def on_step(step_data):
            print(f"STEP {step_data['step']}: {step_data['action']}")

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

        print("WS: running agent")
        result = await agent.run_task(task_data["task"], browser, on_step=on_step)

        print(f"WS: agent finished -> {result}")

        final_status = result.get("status", "completed")
        update_task(task_id, status=final_status, result=result)

        await websocket.send_json({
            "type": "done",
            "result": result
        })

        print("WS: done sent")

    except WebSocketDisconnect:
        print("WS: disconnected")
        update_task(task_id, status="disconnected")

    except Exception as e:
        print(f"WS ERROR: {e}")
        update_task(task_id, status="failed")

        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass

    finally:
        print("WS: cleaning up")
        await browser.stop()

        try:
            await websocket.close()
        except:
            pass


@app.get("/task/{task_id}")
async def get_single_task(task_id: str, user=Depends(get_current_user)):
    task = get_task(task_id, user["id"])

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return task