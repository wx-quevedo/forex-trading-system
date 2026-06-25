"""Arranque del bridge: `python run.py` (equivalente a uvicorn app.main:app)."""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.bridge_host,
        port=settings.bridge_port,
        reload=True,
    )
