"""SafeJSONResponse: NaN/Inf no deben reventar la serialización (Starlette usa allow_nan=False).

Un solo float no finito en un reporte grande (sharpe con varianza 0, calmar/profit_factor
con denominador 0) hacía 500 al serializar. Se neutralizan a null (JSON válido)."""

from __future__ import annotations

import json

from app.main import SafeJSONResponse, _sanitize_nonfinite


def test_sanitiza_nan_inf_recursivo():
    src = {
        "sharpe": float("nan"),
        "calmar": float("inf"),
        "neg": float("-inf"),
        "ok": 1.23,
        "row": {"profit_factor": float("inf"), "win": 0.5},
        "list": [float("nan"), 2.0, {"x": float("inf")}],
    }
    out = _sanitize_nonfinite(src)
    assert out["sharpe"] is None
    assert out["calmar"] is None
    assert out["neg"] is None
    assert out["ok"] == 1.23
    assert out["row"]["profit_factor"] is None
    assert out["row"]["win"] == 0.5
    assert out["list"][0] is None and out["list"][1] == 2.0 and out["list"][2]["x"] is None


def test_render_no_revienta_con_no_finitos():
    # Antes: json.dumps(allow_nan=False) lanzaba ValueError → 500. Ahora produce JSON válido.
    body = SafeJSONResponse(content={"results": [{"sharpe": float("inf"), "calmar": float("nan")}]}).body
    parsed = json.loads(body)  # json.loads por defecto NO acepta NaN/Infinity → valida que son null
    assert parsed["results"][0]["sharpe"] is None
    assert parsed["results"][0]["calmar"] is None
