from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_auth_me_requires_token():
    response = client.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"