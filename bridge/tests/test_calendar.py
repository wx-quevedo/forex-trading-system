"""Tests del calendario económico defensivo (Fase 6): parseo del feed, marcado por
ventana/impacto, ventana de noticia ±N min, símbolo→divisas y NFP por regla."""

from __future__ import annotations

import datetime as dt

from app.econcal import events_in, news_window_active, symbol_currencies
from app.econcal.sources import parse_feed
from app.econcal.seed import nfp_events, _first_friday


def _ts(iso: str) -> int:
    return int(dt.datetime.fromisoformat(iso).timestamp())


# --------------------------------------------------------------------------- #
# símbolo → divisas
# --------------------------------------------------------------------------- #
def test_symbol_currencies():
    assert symbol_currencies("EURUSD#") == ["EUR", "USD"]
    assert symbol_currencies("USDJPY#") == ["USD", "JPY"]
    assert symbol_currencies("GOLD#") == ["USD"]
    assert symbol_currencies("US500Cash#") == ["USD"]
    assert symbol_currencies("OILCash#") == ["USD"]


# --------------------------------------------------------------------------- #
# Parseo del feed de ForexFactory (JSON mockeado, sin red)
# --------------------------------------------------------------------------- #
def test_parse_feed():
    raw = [
        {"title": "Non-Farm Employment Change", "country": "USD", "date": "2026-03-06T13:30:00-00:00", "impact": "High"},
        {"title": "ECB Press Conference", "country": "EUR", "date": "2026-03-12T13:45:00+00:00", "impact": "High"},
        {"title": "Algo sin fecha", "country": "GBP", "date": "", "impact": "Low"},
    ]
    evs = parse_feed(raw)
    assert len(evs) == 2  # el de fecha vacía se descarta
    assert evs[0]["currency"] == "USD" and evs[0]["impact"] == "High"
    assert evs[0]["source"] == "feed" and evs[0]["status"] == "confirmed"


# --------------------------------------------------------------------------- #
# Marcado: events_in filtra por periodo, impacto y divisa
# --------------------------------------------------------------------------- #
def _sample():
    return [
        {"time": _ts("2026-03-06T13:30:00"), "currency": "USD", "impact": "High", "title": "NFP"},
        {"time": _ts("2026-03-10T09:00:00"), "currency": "EUR", "impact": "Medium", "title": "EU Sentiment"},
        {"time": _ts("2026-03-18T18:00:00"), "currency": "USD", "impact": "High", "title": "FOMC"},
        {"time": _ts("2026-04-01T13:30:00"), "currency": "USD", "impact": "Low", "title": "Minor"},
    ]


def test_events_in_filters_period_impact_currency():
    evs = _sample()
    frm, to = _ts("2026-03-01T00:00:00"), _ts("2026-03-31T23:59:59")
    high_usd = events_in(evs, frm, to, ["USD"], "high")
    assert [e["title"] for e in high_usd] == ["NFP", "FOMC"]  # ordenados, solo USD high en marzo
    # Medium incluye el evento EUR si pedimos esa divisa e impacto.
    assert len(events_in(evs, frm, to, ["EUR"], "medium")) == 1
    # Fuera de periodo: el de abril no aparece.
    assert all(e["title"] != "Minor" for e in high_usd)


# --------------------------------------------------------------------------- #
# Ventana de noticia ±N min (defensa en vivo)
# --------------------------------------------------------------------------- #
def test_news_window_active():
    evs = _sample()
    fomc = _ts("2026-03-18T18:00:00")
    # 10 min antes del FOMC, ventana 15 → activa.
    active, ev = news_window_active(fomc - 600, evs, ["USD"], 15, "high")
    assert active and ev["title"] == "FOMC"
    # 30 min antes, ventana 15 → inactiva.
    assert news_window_active(fomc - 1800, evs, ["USD"], 15, "high")[0] is False
    # Misma hora pero otra divisa (EUR) → no aplica al símbolo USD-only.
    assert news_window_active(fomc, evs, ["JPY"], 15, "high")[0] is False
    # Evento de bajo impacto no dispara la pausa.
    minor = _ts("2026-04-01T13:30:00")
    assert news_window_active(minor, evs, ["USD"], 15, "high")[0] is False


# --------------------------------------------------------------------------- #
# NFP por regla determinista
# --------------------------------------------------------------------------- #
def test_nfp_rule_first_friday():
    # Primer viernes de marzo 2026 = 6 de marzo.
    assert _first_friday(2026, 3) == dt.date(2026, 3, 6)
    evs = nfp_events(2026, 2026)
    assert len(evs) == 12  # uno por mes
    march = [e for e in evs if dt.datetime.fromtimestamp(e["time"], dt.timezone.utc).month == 3][0]
    d = dt.datetime.fromtimestamp(march["time"], dt.timezone.utc)
    assert (d.day, d.hour, d.minute) == (6, 13, 30)
    assert march["currency"] == "USD" and march["impact"] == "High" and march["status"] == "confirmed"
