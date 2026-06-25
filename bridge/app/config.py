"""Configuración del bridge cargada desde `.env` vía pydantic-settings."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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

    # Servidor
    bridge_host: str = "0.0.0.0"
    bridge_port: int = 8000

    allowed_origins: str = "*"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
