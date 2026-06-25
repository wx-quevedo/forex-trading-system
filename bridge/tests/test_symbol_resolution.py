"""Tests de la resolución de símbolo operable (fix sufijo del broker, sin MT5)."""

import types

import app.mt5_client as mc


class FakeSym:
    def __init__(self, name, trade_mode, visible=True):
        self.name = name
        self.trade_mode = trade_mode
        self.visible = visible


def _fake_mt5(syms):
    by = {s.name: s for s in syms}
    selected = []

    fake = types.SimpleNamespace(
        SYMBOL_TRADE_MODE_DISABLED=0,
        SYMBOL_TRADE_MODE_FULL=4,
        symbol_info=lambda name: by.get(name),
        symbols_get=lambda group=None: list(syms),
        symbol_select=lambda name, on: selected.append(name) or True,
    )
    return fake, selected


def _client(monkeypatch, syms):
    fake, selected = _fake_mt5(syms)
    monkeypatch.setattr(mc, "mt5", fake)
    monkeypatch.setattr(mc, "MT5_AVAILABLE", True)
    c = mc.MT5Client()
    monkeypatch.setattr(c, "ensure_connected", lambda: None)
    return c, selected


def test_resolves_disabled_base_to_hash_variant(monkeypatch):
    # EURUSD trade_mode=0 (solo datos) -> EURUSD# trade_mode=4 (operable, oculto)
    syms = [FakeSym("EURUSD", 0), FakeSym("EURUSD#", 4, visible=False), FakeSym("EURUSDT", 4)]
    c, selected = _client(monkeypatch, syms)
    assert c.resolve_tradable_symbol("EURUSD") == "EURUSD#"
    assert "EURUSD#" in selected  # se activó en Market Watch


def test_prefers_separator_suffix_over_alpha(monkeypatch):
    # No debe confundir EURUSD con EURUSDT (otro instrumento operable).
    syms = [FakeSym("EURUSD", 0), FakeSym("EURUSDT", 4), FakeSym("EURUSD#", 4)]
    c, _ = _client(monkeypatch, syms)
    assert c.resolve_tradable_symbol("EURUSD") == "EURUSD#"


def test_base_already_tradable_is_returned(monkeypatch):
    syms = [FakeSym("USDCNH#", 4)]
    c, _ = _client(monkeypatch, syms)
    assert c.resolve_tradable_symbol("USDCNH#") == "USDCNH#"


def test_caches_and_is_case_insensitive(monkeypatch):
    syms = [FakeSym("EURUSD", 0), FakeSym("EURUSD#", 4)]
    c, selected = _client(monkeypatch, syms)
    assert c.resolve_tradable_symbol("eurusd") == "EURUSD#"
    assert c._tradable_cache["EURUSD"] == "EURUSD#"
    assert c.resolve_tradable_symbol("EURUSD") == "EURUSD#"  # desde caché


def test_no_variant_falls_back_to_base(monkeypatch):
    syms = [FakeSym("XAUUSD", 0)]  # ninguna variante operable
    c, _ = _client(monkeypatch, syms)
    assert c.resolve_tradable_symbol("XAUUSD") == "XAUUSD"
