"""Configuración del bridge cargada desde `.env` vía pydantic-settings."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Ruta absoluta al .env (raíz del bridge), para que se cargue sin importar el CWD
# desde el que se arranque (p.ej. el subproceso de --reload de uvicorn).
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Credenciales del broker (cuenta demo en desarrollo)
    mt5_login: int = 0
    mt5_password: str = ""
    mt5_server: str = ""
    mt5_path: str = ""  # ruta opcional a terminal64.exe

    # Seguridad
    bridge_api_key: str = ""

    # Servidor. Default SEGURO 127.0.0.1: el bridge ejecuta órdenes reales y nunca
    # debe exponerse a la red (ver FOREXBOT_RED_LOCAL.md). Solo Laravel lo consume
    # desde la misma máquina.
    bridge_host: str = "127.0.0.1"
    bridge_port: int = 8000

    allowed_origins: str = "*"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
