"""Modelos Pydantic de entrada/salida del bridge."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class OrderRequest(BaseModel):
    symbol: str = Field(..., examples=["EURUSD"])
    type: Literal["BUY", "SELL"]
    volume: float = Field(..., gt=0, examples=[0.01])
    price: float | None = Field(default=None, description="Si se omite, usa precio de mercado.")
    sl: float | None = Field(default=None, description="Stop loss (precio absoluto).")
    tp: float | None = Field(default=None, description="Take profit (precio absoluto).")
    deviation: int = Field(default=20, ge=0)
    comment: str = Field(default="forexbot", max_length=31)
    magic: int = Field(default=990001)


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    mt5_error: Any | None = None
