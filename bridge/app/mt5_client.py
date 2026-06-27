"""Wrapper sobre la librería oficial MetaTrader5.

Centraliza:
- Inicialización y login al terminal MT5.
- Reconexión automática (lazy) cuando la conexión se cae.
- Manejo gracioso de errores (terminal offline, mercado cerrado, símbolo inválido).
- Serialización de tipos MT5 (namedtuples, numpy structured arrays) a JSON.

La librería oficial `MetaTrader5` SOLO funciona en Windows. El import se hace de
forma defensiva para que el resto del código (y los tests) puedan importarse
incluso si la librería no está instalada todavía.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .config import settings

try:  # pragma: no cover - depende de plataforma
    import MetaTrader5 as mt5  # type: ignore
    MT5_AVAILABLE = True
except Exception:  # ImportError en no-Windows o si no está instalada
    mt5 = None  # type: ignore
    MT5_AVAILABLE = False


# --------------------------------------------------------------------------- #
# Errores
# --------------------------------------------------------------------------- #
class MT5Error(Exception):
    """Error de dominio del bridge. `code` mapea a un HTTP status en main.py."""

    def __init__(self, message: str, *, code: int = 502, mt5_error: Any = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.mt5_error = mt5_error


# --------------------------------------------------------------------------- #
# Mapeo de timeframes
# --------------------------------------------------------------------------- #
def _timeframe_map() -> dict[str, int]:
    if not MT5_AVAILABLE:
        return {}
    return {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
        "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }


def resolve_timeframe(tf: str) -> int:
    mapping = _timeframe_map()
    key = tf.upper()
    if key not in mapping:
        raise MT5Error(
            f"Timeframe inválido '{tf}'. Válidos: {', '.join(mapping or ['M1','M5','M15','M30','H1','H4','D1'])}",
            code=400,
        )
    return mapping[key]


# --------------------------------------------------------------------------- #
# Cliente / conexión
# --------------------------------------------------------------------------- #
class MT5Client:
    """Mantiene la conexión al terminal MT5 con reconexión perezosa."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connected = False
        self._tradable_cache: dict[str, str] = {}  # base -> símbolo operable resuelto

    # -- ciclo de vida -----------------------------------------------------
    def connect(self) -> bool:
        """Inicializa el terminal y hace login. Idempotente."""
        if not MT5_AVAILABLE:
            raise MT5Error(
                "La librería MetaTrader5 no está disponible. "
                "El bridge debe ejecutarse en Windows con MT5 instalado.",
                code=503,
            )
        with self._lock:
            kwargs: dict[str, Any] = {}
            if settings.mt5_path:
                kwargs["path"] = settings.mt5_path
            if settings.mt5_login:
                kwargs.update(
                    login=int(settings.mt5_login),
                    password=settings.mt5_password,
                    server=settings.mt5_server,
                )

            if not mt5.initialize(**kwargs):
                err = mt5.last_error()
                self._connected = False
                raise MT5Error(
                    "No se pudo inicializar el terminal MT5. "
                    "Verifica que MT5 esté instalado, abierto y las credenciales en .env.",
                    code=503,
                    mt5_error=err,
                )
            self._connected = True
            return True

    def shutdown(self) -> None:
        if MT5_AVAILABLE and self._connected:
            mt5.shutdown()
        self._connected = False

    def ensure_connected(self) -> None:
        """Garantiza una conexión viva; reconecta si hace falta."""
        if not MT5_AVAILABLE:
            raise MT5Error(
                "La librería MetaTrader5 no está disponible (requiere Windows + MT5).",
                code=503,
            )
        # terminal_info() devuelve None si el terminal no está conectado.
        if not self._connected or mt5.terminal_info() is None:
            self.connect()

    def status(self) -> dict[str, Any]:
        """Estado del bridge/terminal sin lanzar excepciones."""
        info: dict[str, Any] = {
            "mt5_library_available": MT5_AVAILABLE,
            "connected": False,
            "terminal": None,
            "account_login": settings.mt5_login or None,
            "server": settings.mt5_server or None,
        }
        if not MT5_AVAILABLE:
            return info
        try:
            term = mt5.terminal_info()
            if term is not None:
                info["connected"] = bool(term.connected)
                info["terminal"] = _to_jsonable(term._asdict())
        except Exception:  # noqa: BLE001 - status nunca debe romper
            pass
        return info

    # -- cuenta ------------------------------------------------------------
    def account_info(self) -> dict[str, Any]:
        self.ensure_connected()
        info = mt5.account_info()
        if info is None:
            raise MT5Error("No se pudo obtener account_info().", mt5_error=mt5.last_error())
        return _to_jsonable(info._asdict())

    # -- símbolos / precios ------------------------------------------------
    def symbols(self, group: str | None = None) -> list[dict[str, Any]]:
        self.ensure_connected()
        syms = mt5.symbols_get(group) if group else mt5.symbols_get()
        if syms is None:
            raise MT5Error("No se pudieron obtener los símbolos.", mt5_error=mt5.last_error())
        return [
            {
                "name": s.name,
                "description": s.description,
                "path": s.path,
                "digits": s.digits,
                "spread": s.spread,
                "trade_mode": s.trade_mode,
                "visible": s.visible,
                "bid": s.bid,
                "ask": s.ask,
            }
            for s in syms
        ]

    def symbol_info(self, symbol: str) -> dict[str, Any]:
        """Info de un símbolo (incluye `digits`, precisión de precio del par)."""
        self.ensure_connected()
        info = mt5.symbol_info(symbol)
        if info is None:
            raise MT5Error(f"Símbolo desconocido: '{symbol}'.", code=404, mt5_error=mt5.last_error())
        return {
            "name": info.name,
            "description": info.description,
            "path": info.path,
            "digits": int(info.digits),
            "point": float(info.point),
            "spread": int(info.spread),
            "swap_long": float(info.swap_long),
            "swap_short": float(info.swap_short),
            "trade_mode": int(info.trade_mode),
            "visible": bool(info.visible),
        }

    def symbol_session(self, symbol: str) -> dict[str, Any]:
        """Estado de mercado del símbolo (informativo): abierto/cerrado ahora + próximo cambio.

        'abierto' se determina por la frescura del último tick (fiable y simple);
        el próximo cambio usa el horario semanal (forex cierra el finde; cripto ~24/7).
        Horas devueltas en UTC real.
        """
        self.ensure_connected()
        self._ensure_symbol(symbol)
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        off = self.server_offset()
        now = datetime.now(tz=timezone.utc)
        now_ts = now.timestamp()

        last_real = (int(tick.time) - off) if tick and tick.time else None
        age = (now_ts - last_real) if last_real else None
        is_open = age is not None and age < 180  # tick reciente => mercado activo

        path = (info.path if info else "") or ""
        is_crypto = path.lower().startswith("crypto")

        next_change = None
        next_type = None
        if is_crypto:
            note = "Cripto: opera prácticamente 24/7."
        else:
            # Forex/índices: aproximación de fin de semana (abre dom ~21:00, cierra vie ~21:00 UTC).
            wd, h = now.weekday(), now.hour  # lun=0 .. dom=6
            from datetime import timedelta

            def at(d, hour):
                return d.replace(hour=hour, minute=0, second=0, microsecond=0)

            if is_open:
                # próximo cierre: viernes 21:00 UTC
                days = (4 - wd) % 7
                fri = at(now + timedelta(days=days), 21)
                if fri <= now:
                    fri = fri + timedelta(days=7)
                next_change, next_type = fri.timestamp(), "close"
                note = "Mercado abierto."
            else:
                # próxima apertura: domingo 21:00 UTC
                days = (6 - wd) % 7
                sun = at(now + timedelta(days=days), 21)
                if sun <= now:
                    sun = sun + timedelta(days=7)
                next_change, next_type = sun.timestamp(), "open"
                note = "Mercado cerrado (fin de semana o fuera de sesión)."

        return {
            "symbol": symbol,
            "open": bool(is_open),
            "last_tick_age_seconds": round(age) if age is not None else None,
            "next_change": int(next_change) if next_change else None,
            "next_change_type": next_type,
            "note": note,
        }

    def server_offset(self) -> int:
        """Segundos que el servidor del broker va por delante de UTC real.

        XM usa EET/EEST (+2 invierno, +3 verano; DST UE: último domingo de marzo a
        las 01:00 UTC → último domingo de octubre 01:00 UTC). Los timestamps de MT5
        vienen en hora del servidor tratada como UTC; restando este offset quedan en
        UTC real (consistente con los ISO que genera el runner)."""
        import calendar

        now = datetime.now(tz=timezone.utc)
        y = now.year

        def last_sunday(month: int) -> int:
            return max(week[6] for week in calendar.monthcalendar(y, month) if week[6])

        start = datetime(y, 3, last_sunday(3), 1, tzinfo=timezone.utc)
        end = datetime(y, 10, last_sunday(10), 1, tzinfo=timezone.utc)
        return 3 * 3600 if start <= now < end else 2 * 3600

    def symbol_costs(self, symbol: str) -> dict[str, Any]:
        """Costos reales del broker para el backtest: spread (en pips), swap y punto."""
        self.ensure_connected()
        info = mt5.symbol_info(symbol)
        if info is None:
            return {}
        pip = 0.01 if symbol.upper().endswith("JPY") else 0.0001
        spread_pips = (info.spread * info.point) / pip if pip else 0.0
        return {
            "spread_pips": round(spread_pips, 3),
            "swap_long_pts": float(info.swap_long),
            "swap_short_pts": float(info.swap_short),
            "point": float(info.point),
        }

    def _ensure_symbol(self, symbol: str) -> None:
        # Activar SIEMPRE primero: un símbolo oculto que MT5 nunca seleccionó puede
        # devolver symbol_info=None hasta hacer symbol_select (causa de "símbolo
        # desconocido" en cripto/ocultos como BTCUSD#).
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
        if info is None:
            raise MT5Error(f"Símbolo desconocido: '{symbol}'.", code=404, mt5_error=mt5.last_error())
        if not info.visible and not mt5.symbol_select(symbol, True):
            raise MT5Error(
                f"No se pudo seleccionar el símbolo '{symbol}' en Market Watch.",
                mt5_error=mt5.last_error(),
            )

    def resolve_tradable_symbol(self, base: str) -> str:
        """Resuelve el símbolo OPERABLE real del broker para un símbolo base.

        Muchos brokers (p.ej. XM Ultra Low) exponen una variante de cada par solo
        para datos (`trade_mode == DISABLED`) y otra operable con sufijo
        (`EURUSD#`, o `.m`, `.raw`, etc. según el broker). Operar la deshabilitada
        devuelve `retcode 10017`. Esto encuentra y activa la variante operable.

        Genérico (no hardcodea `#`) y cacheado. Si ya es operable, lo devuelve tal cual.
        """
        self.ensure_connected()
        base_u = base.strip().upper()
        if base_u in self._tradable_cache:
            return self._tradable_cache[base_u]

        info = mt5.symbol_info(base_u)
        if info is not None and info.trade_mode != mt5.SYMBOL_TRADE_MODE_DISABLED:
            resolved = info.name  # el base ya es operable
        else:
            resolved = self._find_tradable_variant(base_u) or base_u

        mt5.symbol_select(resolved, True)  # activarlo en Market Watch si está oculto
        self._tradable_cache[base_u] = resolved
        return resolved

    def _find_tradable_variant(self, base_u: str) -> str | None:
        """Busca un símbolo operable cuyo nombre empiece por el base + sufijo."""
        syms = mt5.symbols_get()
        if not syms:
            return None
        disabled = mt5.SYMBOL_TRADE_MODE_DISABLED
        full = mt5.SYMBOL_TRADE_MODE_FULL

        candidates = []
        for s in syms:
            name = s.name.upper()
            if not name.startswith(base_u) or s.trade_mode == disabled:
                continue
            rem = name[len(base_u):]
            # Preferir sufijos separadores ('#', '.', '_', '-') frente a alfabéticos
            # (evita confundir EURUSD con EURUSDT, otro instrumento).
            sep = (rem == "") or (not rem[0].isalnum())
            candidates.append((s, rem, sep))

        if not candidates:
            return None
        # Ranking: operable completo (FULL) > sufijo separador > sufijo más corto.
        best = max(candidates, key=lambda c: (c[0].trade_mode == full, c[2], -len(c[1])))
        return best[0].name

    def price(self, symbol: str) -> dict[str, Any]:
        self.ensure_connected()
        self._ensure_symbol(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5Error(
                f"Sin tick para '{symbol}'. ¿Mercado cerrado o símbolo inactivo?",
                code=409,
                mt5_error=mt5.last_error(),
            )
        data = _to_jsonable(tick._asdict())
        if "time" in data:
            data["time"] = int(data["time"]) - self.server_offset()  # hora servidor → UTC real
        data["symbol"] = symbol
        return data

    def candles(
        self,
        symbol: str,
        timeframe: str,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        count: int | None = None,
    ) -> list[dict[str, Any]]:
        import time as _time

        self.ensure_connected()
        self._ensure_symbol(symbol)
        tf = resolve_timeframe(timeframe)
        pos_to = date_to or datetime.now(tz=timezone.utc)

        def _fetch():
            if count is not None and date_from is None:
                return mt5.copy_rates_from(symbol, tf, pos_to, count)
            if date_from is None:
                raise MT5Error("Debe indicarse 'from' (o 'count') para obtener velas.", code=400)
            return mt5.copy_rates_range(symbol, tf, date_from, pos_to)

        # Símbolos ocultos (cripto/poco usados) pueden no tener histórico precargado:
        # tras seleccionarlos, MT5 lo descarga del servidor. Reintentar brevemente.
        rates = _fetch()
        for _ in range(3):
            if rates is not None and len(rates) > 0:
                break
            _time.sleep(0.6)
            rates = _fetch()

        if rates is None or len(rates) == 0:
            raise MT5Error(
                f"MT5 no tiene histórico disponible para '{symbol}' en {timeframe}. "
                "Puede tardar en descargarse; reintenta en unos segundos o elige otro periodo/símbolo.",
                code=409,
                mt5_error=mt5.last_error(),
            )
        out = _rates_to_list(rates)
        # Normalizar de hora del servidor a UTC real.
        off = self.server_offset()
        for c in out:
            c["time"] = int(c["time"]) - off
            c["datetime"] = datetime.fromtimestamp(c["time"], tz=timezone.utc).isoformat()
        return out

    # -- posiciones / órdenes / historial ----------------------------------
    def positions(self, symbol: str | None = None) -> list[dict[str, Any]]:
        self.ensure_connected()
        pos = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
        if pos is None:
            # positions_get devuelve None cuando hay error real; () si no hay posiciones.
            err = mt5.last_error()
            if err and err[0] != 1:  # 1 == RES_S_OK
                raise MT5Error("Error obteniendo posiciones.", mt5_error=err)
            return []
        off = self.server_offset()
        out = []
        for p in pos:
            d = _to_jsonable(p._asdict())
            if "time" in d:
                d["time"] = int(d["time"]) - off  # hora servidor → UTC real
            out.append(d)
        return out

    def closed_position_pnl(self, ticket: int) -> dict[str, Any] | None:
        """PnL realizado de una posición ya cerrada (usado por el bot para
        reconciliar cierres por SL/TP). Suma profit+commission+swap de sus deals."""
        self.ensure_connected()
        deals = mt5.history_deals_get(position=ticket)
        if not deals:
            return None
        pnl = sum(float(d.profit) + float(d.commission) + float(d.swap) for d in deals)
        closing = deals[-1]
        return {
            "pnl": round(pnl, 2),
            "close_price": float(closing.price),
            "close_time": int(closing.time),
        }

    def orders(self, symbol: str | None = None) -> list[dict[str, Any]]:
        self.ensure_connected()
        orders = mt5.orders_get(symbol=symbol) if symbol else mt5.orders_get()
        if orders is None:
            err = mt5.last_error()
            if err and err[0] != 1:
                raise MT5Error("Error obteniendo órdenes pendientes.", mt5_error=err)
            return []
        return [_to_jsonable(o._asdict()) for o in orders]

    def history_deals(self, date_from: datetime, date_to: datetime) -> list[dict[str, Any]]:
        self.ensure_connected()
        deals = mt5.history_deals_get(date_from, date_to)
        if deals is None:
            err = mt5.last_error()
            if err and err[0] != 1:
                raise MT5Error("Error obteniendo historial de deals.", mt5_error=err)
            return []
        return [_to_jsonable(d._asdict()) for d in deals]

    # -- trading -----------------------------------------------------------
    def send_order(
        self,
        symbol: str,
        order_type: str,
        volume: float,
        price: float | None = None,
        sl: float | None = None,
        tp: float | None = None,
        deviation: int = 20,
        comment: str = "forexbot",
        magic: int = 990001,
    ) -> dict[str, Any]:
        """Envía una orden de mercado BUY/SELL vía mt5.order_send()."""
        self.ensure_connected()
        # Resolver al símbolo OPERABLE del broker (evita retcode 10017 en variantes
        # solo-datos como EURUSD trade_mode=0 → usa EURUSD#).
        symbol = self.resolve_tradable_symbol(symbol)
        self._ensure_symbol(symbol)

        side = order_type.upper()
        if side not in ("BUY", "SELL"):
            raise MT5Error("order_type debe ser 'BUY' o 'SELL'.", code=400)

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5Error(
                f"Sin precio para '{symbol}' (¿mercado cerrado?).", code=409, mt5_error=mt5.last_error()
            )

        mt5_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        fill_price = price if price is not None else (tick.ask if side == "BUY" else tick.bid)

        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(volume),
            "type": mt5_type,
            "price": float(fill_price),
            "deviation": int(deviation),
            "magic": int(magic),
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        if sl is not None:
            request["sl"] = float(sl)
        if tp is not None:
            request["tp"] = float(tp)

        result = mt5.order_send(request)
        if result is None:
            raise MT5Error("order_send() devolvió None.", mt5_error=mt5.last_error())

        payload = _to_jsonable(result._asdict())
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise MT5Error(
                f"Orden rechazada por el broker (retcode {result.retcode}): {result.comment}",
                code=422,
                mt5_error=payload,
            )
        return payload

    def close_position(self, ticket: int, deviation: int = 20) -> dict[str, Any]:
        """Cierra una posición abierta por su ticket."""
        self.ensure_connected()
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            raise MT5Error(f"No existe posición abierta con ticket {ticket}.", code=404)
        pos = positions[0]

        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            raise MT5Error(
                f"Sin precio para cerrar '{pos.symbol}' (¿mercado cerrado?).",
                code=409,
                mt5_error=mt5.last_error(),
            )

        # Para cerrar: tipo opuesto al de la posición.
        if pos.type == mt5.POSITION_TYPE_BUY:
            close_type = mt5.ORDER_TYPE_SELL
            price = tick.bid
        else:
            close_type = mt5.ORDER_TYPE_BUY
            price = tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": float(pos.volume),
            "type": close_type,
            "position": int(ticket),
            "price": float(price),
            "deviation": int(deviation),
            "magic": int(pos.magic),
            "comment": "forexbot-close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        if result is None:
            raise MT5Error("order_send() (cierre) devolvió None.", mt5_error=mt5.last_error())

        payload = _to_jsonable(result._asdict())
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise MT5Error(
                f"Cierre rechazado (retcode {result.retcode}): {result.comment}",
                code=422,
                mt5_error=payload,
            )
        return payload


# --------------------------------------------------------------------------- #
# Serialización
# --------------------------------------------------------------------------- #
def _to_jsonable(obj: Any) -> Any:
    """Convierte tipos numpy / dict de MT5 a tipos JSON-serializables."""
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    return obj


def _rates_to_list(rates: np.ndarray) -> list[dict[str, Any]]:
    """Convierte el structured array de copy_rates_* a lista de velas OHLCV."""
    out: list[dict[str, Any]] = []
    for r in rates:
        ts = int(r["time"])
        out.append(
            {
                "time": ts,
                "datetime": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "tick_volume": int(r["tick_volume"]),
                "spread": int(r["spread"]) if "spread" in rates.dtype.names else None,
                "real_volume": int(r["real_volume"]) if "real_volume" in rates.dtype.names else None,
            }
        )
    return out


# Instancia única usada por los routers.
client = MT5Client()
