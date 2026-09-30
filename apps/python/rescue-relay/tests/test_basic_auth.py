"""HTTP Basic protection for remotely reachable deployments."""
import base64

import pytest

import app as relay


def basic(username: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture
def protected(client, monkeypatch):
    monkeypatch.setattr(relay, "APP_ENV", "production")
    monkeypatch.setattr(relay, "BASIC_AUTH_USERNAME", "reviewer", raising=False)
    monkeypatch.setattr(relay, "BASIC_AUTH_PASSWORD", "correct horse battery staple", raising=False)
    return client


@pytest.mark.parametrize("method,path", [
    ("get", "/"),
    ("get", "/static/index.html"),
    ("get", "/api/config"),
    ("post", "/api/incidents"),
])
def test_production_routes_require_basic_auth(protected, method, path):
    response = getattr(protected, method)(path)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == 'Basic realm="Rescue Relay", charset="UTF-8"'
    assert response.json() == {"detail": "Authentication required."}


def test_health_remains_public_for_render(protected):
    response = protected.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "5.6.0"}


def test_valid_basic_auth_allows_access_without_disclosing_credentials(protected):
    response = protected.get("/api/config", headers=basic("reviewer", "correct horse battery staple"))
    assert response.status_code == 200
    assert "reviewer" not in response.text
    assert "correct horse battery staple" not in response.text


@pytest.mark.parametrize("header", [
    "",
    "Bearer not-basic",
    "Basic !!!not-base64!!!",
    "Basic " + base64.b64encode(b"reviewer:wrong").decode(),
])
def test_invalid_authorization_never_reaches_application(protected, header):
    headers = {"Authorization": header} if header else {}
    assert protected.get("/api/config", headers=headers).status_code == 401


def test_production_fails_closed_when_credentials_are_missing(client, monkeypatch):
    monkeypatch.setattr(relay, "APP_ENV", "production")
    monkeypatch.setattr(relay, "BASIC_AUTH_USERNAME", "", raising=False)
    monkeypatch.setattr(relay, "BASIC_AUTH_PASSWORD", "", raising=False)
    response = client.get("/api/config")
    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication is not configured."}
    assert client.get("/health").status_code == 200


def test_local_default_remains_credential_free(client, monkeypatch):
    monkeypatch.setattr(relay, "APP_ENV", "local")
    monkeypatch.setattr(relay, "BASIC_AUTH_USERNAME", "", raising=False)
    monkeypatch.setattr(relay, "BASIC_AUTH_PASSWORD", "", raising=False)
    assert client.get("/api/config").status_code == 200


def test_local_environment_ignores_stored_production_credentials(client, monkeypatch):
    monkeypatch.setattr(relay, "APP_ENV", "local")
    monkeypatch.setattr(relay, "BASIC_AUTH_USERNAME", "reviewer", raising=False)
    monkeypatch.setattr(relay, "BASIC_AUTH_PASSWORD", "stored-production-secret", raising=False)
    assert client.get("/api/config").status_code == 200
