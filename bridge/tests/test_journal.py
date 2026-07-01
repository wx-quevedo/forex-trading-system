"""Journal persistente del bot: append-only, sobrevive 'reinicios' (relee del archivo) y
el corte de día (no depende del estado en memoria). Y caducidad del arme (_hours_since)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.bot import journal
from app.bot.runner import _hours_since


def test_append_y_tail_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(journal, "_JOURNAL_FILE", tmp_path / "j.jsonl")
    run = {"strategy_id": 33, "symbol": "GOLD#", "timeframe": "H4", "strategy_type": "macd", "magic": 770033}
    journal.append("open", run, {"direction": "sell", "volume": 0.02, "risk_usd": 117.66})
    journal.append("close", run, {"pnl": -118.40, "close_reason": "sl"})
    got = journal.tail(50)
    assert len(got) == 2
    assert got[0]["kind"] == "open" and got[0]["symbol"] == "GOLD#" and got[0]["risk_usd"] == 117.66
    assert got[1]["kind"] == "close" and got[1]["pnl"] == -118.40


def test_sobrevive_relectura_y_tolera_lineas_corruptas(tmp_path, monkeypatch):
    f = tmp_path / "j.jsonl"
    monkeypatch.setattr(journal, "_JOURNAL_FILE", f)
    for i in range(5):
        journal.append("open", {"strategy_id": i}, {"n": i})
    f.write_text(f.read_text(encoding="utf-8") + "{linea rota\n", encoding="utf-8")  # corrupta
    got = journal.tail(4)  # 'reinicio': relee del disco (últimas 4 líneas: n=2,3,4 + corrupta)
    assert [g["n"] for g in got] == [2, 3, 4]  # ignora la corrupta, devuelve las válidas


def test_hours_since():
    assert _hours_since(None) == 0.0
    ago = (datetime.now(tz=timezone.utc) - timedelta(hours=25)).isoformat()
    assert _hours_since(ago) >= 24.0
    recent = (datetime.now(tz=timezone.utc) - timedelta(hours=1)).isoformat()
    assert 0.5 < _hours_since(recent) < 2.0
