"""Tests de humo del bridge (no requieren MT5 conectado).

Verifican que la app levanta, los health checks responden y la autenticación
protege los endpoints del Módulo 1. Las llamadas reales a MT5 se prueban
manualmente con la demo conectada (ver README).
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_ok():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "forexbot-mt5-bridge"


def test_health_no_auth():
    r = client.get("/health")
    assert r.status_code == 200
    assert "mt5_library_available" in r.json()


def test_account_requires_api_key():
    r = client.get("/account")
    assert r.status_code == 401


def test_account_with_bad_key():
    r = client.get("/account", headers={"X-API-Key": "wrong"})
    assert r.status_code == 401
