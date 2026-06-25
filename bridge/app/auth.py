"""Autenticación simple del bridge por API key (header X-API-Key)."""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from .config import settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Dependencia FastAPI: valida el header X-API-Key contra BRIDGE_API_KEY.

    El acceso real al bridge está además restringido a la red Tailscale; esta
    clave es una segunda capa para que solo el backend Laravel pueda consumirlo.
    """
    expected = settings.bridge_api_key
    if not expected:
        # Sin clave configurada el bridge no debe aceptar peticiones.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="BRIDGE_API_KEY no configurada en el servidor.",
        )
    if not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key inválida o ausente (header X-API-Key).",
        )
