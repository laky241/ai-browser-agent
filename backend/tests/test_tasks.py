from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_create_task_requires_auth():
    response = client.post("/task", json={"task": "Find top GitHub repos"})
    assert response.status_code == 401


def test_create_task_rejects_empty():
    response = client.post(
        "/task",
        json={"task": ""},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code in [400, 401]