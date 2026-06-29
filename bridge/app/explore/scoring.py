"""Score de PRIORIDAD (mejoras post-fase): pauta de priorización para validar, NO
veredicto de rentabilidad. Premia robustez ante el deterioro y penaliza fragilidad.

Diseño (aprobado): NO entra el retorno absoluto; se usan métricas normalizadas por
riesgo (Sharpe/Sortino/Calmar/expectativa R), win rate como MARGEN, consistencia
in/out, idoneidad de régimen y nº de operaciones. Drawdown penaliza NO linealmente.

Una sola fuente de verdad: devuelve el score Y el desglose (para la modal A3).
El caso real de la ma_cross que falló (Sharpe alto pero win 39%, exp +0.19, DD −30%)
DEBE quedar penalizado (<40, fuera de cabeza). Ver tests."""

from __future__ import annotations

from typing import Any

# Mapa estrategia → régimen idóneo (espejo de lib/regime.ts).
_TREND = {"ma_cross", "macd", "supertrend", "ichimoku", "donchian", "psar"}
_RANGE = {"rsi", "bollinger"}


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _match_class(stype: str, regime: str | None) -> str | None:
    """MATCH / MISMATCH / NEUTRO / None según tipo de estrategia y régimen."""
    if not regime:
        return None
    if regime == "VOLATIL":
        return "CAUTION"
    rclass = "trend" if regime in ("TENDENCIA_ALCISTA", "TENDENCIA_BAJISTA") else "range"
    if stype in _TREND:
        ideal = "trend"
    elif stype in _RANGE:
        ideal = "range"
    else:
        return "NEUTRO"
    return "MATCH" if ideal == rclass else "MISMATCH"


def expectancy_r(win_rate: float, sl: float, tp: float) -> float | None:
    if not sl:
        return None
    return round(win_rate * (tp / sl) - (1.0 - win_rate), 3)


def priority_score(row: dict[str, Any], period_days: float) -> dict[str, Any]:
    """Devuelve {score: 0-100, breakdown: [...], verdict: str}."""
    add: list[dict[str, Any]] = []
    sub: list[dict[str, Any]] = []

    win = float(row.get("win_rate") or 0.0)            # fracción 0..1
    in_ret = float(row.get("in_return") or 0.0)
    out_ret = float(row.get("out_return") or 0.0)
    dd = abs(float(row.get("max_drawdown_pct") or 0.0))
    sharpe = float(row.get("sharpe") or 0.0)
    sortino = float(row.get("sortino") or 0.0)
    ret = float(row.get("return_pct") or 0.0)
    ops = int(row.get("total_trades") or 0)
    blown = bool(row.get("blown"))
    er = row.get("expectancy_r")
    if er is None:
        er = expectancy_r(win, float(row.get("sl_pips") or 0), float(row.get("tp_pips") or 0))
    er = float(er) if er is not None else 0.0
    calmar = (ret * 365.0 / period_days / dd) if (period_days > 0 and dd > 0) else None

    def _add(label, pts, detail):
        if pts > 0:
            add.append({"label": label, "points": round(pts, 1), "detail": detail})

    def _sub(label, pts, detail):
        if pts > 0:
            sub.append({"label": label, "points": round(pts, 1), "detail": detail})

    # --- Positivos ---
    if in_ret > 0:
        cons = _clamp(out_ret / in_ret, 0.0, 1.2) / 1.2 if out_ret > 0 else 0.0
    else:
        cons = 0.3 if out_ret > 0 else 0.0
    _add("Consistencia in/out", cons * 25, f"in {in_ret:.1f}% / out {out_ret:.1f}%")
    _add("Expectativa R", _clamp(er / 0.5) * 20, f"+{er:.2f}R" if er >= 0 else f"{er:.2f}R")
    _add("Win rate (margen)", _clamp((win - 0.40) / 0.25) * 10, f"{win * 100:.0f}%")
    if calmar is not None and calmar > 0:
        _add("Calmar", _clamp(calmar / 3.0) * 10, f"{calmar:.2f}")
    _add("Sharpe", _clamp(sharpe / 2.0) * 12, f"{sharpe:.2f}")
    _add("Sortino", _clamp(sortino / 3.0) * 6, f"{sortino:.2f}")
    if ops >= 30:
        _add("Nº operaciones", _clamp((ops - 30) / 70.0) * 9, f"{ops} ops")
    mc = _match_class(row.get("type", ""), row.get("regime"))
    if mc == "MATCH":
        _add("Régimen MATCH", 8, "estrategia coherente con el régimen")
    elif mc == "NEUTRO":
        _add("Régimen neutro", 3, "estrategia mixta")

    # --- Penalizaciones ---
    if dd > 0:
        _sub("Drawdown", min(45.0, (dd / 15.0) ** 2 * 10.0), f"−{dd:.1f}% (penaliza no-lineal)")
    if in_ret > 0 and out_ret < 0.5 * in_ret:
        _sub("Brecha in/out (overfit)", 20.0 if out_ret <= 0 else min(20.0, (1 - out_ret / in_ret) * 20.0),
             f"out {out_ret:.1f}% << in {in_ret:.1f}%")
    if er <= 0:
        _sub("Expectativa negativa", 15.0, f"{er:.2f}R")
    elif er < 0.10:
        _sub("Expectativa delgada", (0.10 - er) / 0.10 * 10.0, f"+{er:.2f}R")
    if mc == "MISMATCH":
        _sub("Régimen MISMATCH", 10.0, "estrategia no encaja con el régimen")
    elif mc == "CAUTION":
        _sub("Régimen volátil", 6.0, "periodo volátil: poca ventaja")
    if ops < 30:
        _sub("Pocas operaciones", 20.0, f"{ops} ops (no significativo)")
    if blown:
        _sub("Cuenta quebrada", 25.0, "la cuenta se quemó en el periodo")

    score = _clamp(sum(a["points"] for a in add) - sum(s["points"] for s in sub), 0, 100)
    score = round(score)

    # Veredicto en lenguaje natural.
    big = [s["label"].lower() for s in sub if s["points"] >= 10]
    if score >= 65 and not big:
        verdict = "Candidata equilibrada, sin señales graves de fragilidad. Buena para validar en walk-forward."
    elif score >= 40:
        verdict = "Candidata mixta: revisa los factores que restan antes de priorizarla."
    else:
        frag = ", ".join(big) if big else "varias señales de fragilidad"
        verdict = f"Frágil pese a números llamativos: {frag}. Prioridad baja para validar."

    return {"score": score, "breakdown": {"add": add, "sub": sub}, "verdict": verdict}
