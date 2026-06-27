"""Arranque del bridge: `python run.py` (equivalente a uvicorn app.main:app)."""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    # reload=False: el reload no recogía cambios de forma fiable y, además,
    # complica el multiprocessing del Explorador en Windows (procesos worker).
    # Para desarrollo se reinicia el bridge a mano.
    uvicorn.run(
        "app.main:app",
        host=settings.bridge_host,
        port=settings.bridge_port,
        reload=False,
    )
