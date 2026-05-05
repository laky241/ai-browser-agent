import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from backend.main import app

client = TestClient(app)


def test_ws_requires_token():
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/fake-task-id"):
            pass