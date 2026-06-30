/**
 * Walk-forward: comparación backtest (prometido) vs validación en datos POSTERIORES
 * que la estrategia nunca optimizó (logrado). Fuente ÚNICA de la lógica de veredicto y
 * ratio, compartida entre el Bot Histórico y el Explorador (consistencia entre pantallas).
 */

export type VerdictKey = 'cumple' | 'degrada' | 'falla' | 'na';

export const VERDICT: Record<VerdictKey, { label: string; cls: string }> = {
    cumple: { label: 'CUMPLE', cls: 'bg-profit/15 text-profit' },
    degrada: { label: 'SE DEGRADA', cls: 'bg-warning/15 text-warning' },
    falla: { label: 'FALLA', cls: 'bg-loss/15 text-loss' },
    na: { label: 'sin referencia', cls: 'bg-bg-elevated text-text-secondary' },
};

/** Días entre dos fechas (mínimo 1). */
export const days = (from?: string | null, to?: string | null): number =>
    from && to ? Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 86400000)) : 0;

/** Anualiza un retorno % medido en `d` días (los periodos duran distinto → comparables). */
export const annualize = (ret: number, d: number): number => (d > 0 ? (ret * 365) / d : ret);

/**
 * Veredicto comparando logrado (A) vs prometido (B), AMBOS anualizados.
 * - B<=0: el backtest no prometía nada → sin referencia (N/A).
 * - quiebra o A<=0 (con B>0): pierde/quiebra en datos nuevos → FALLA.
 *   (Caso ma_cross: prometía +74%, validación −76% → FALLA claramente.)
 * - ratio A/B >= 0.7 → CUMPLE; si no → SE DEGRADA.
 */
export function verdictOf(annA: number, annB: number, blown: boolean): VerdictKey {
    if (annB <= 0) return 'na';
    if (blown || annA <= 0) return 'falla';
    return annA / annB >= 0.7 ? 'cumple' : 'degrada';
}

export interface Compliance {
    ratio: number | null;   // % de cumplimiento (annVal/annBt × 100); null si no hay referencia
    verdict: VerdictKey;
    annBt: number;
    annVal: number;
}

/**
 * Ratio de cumplimiento y veredicto de UNA estrategia: prometido (backtest) vs logrado
 * (validación en rango posterior). Anualiza ambos lados antes de comparar.
 */
export function compliance(
    btReturnPct: number, btDays: number,
    valReturnPct: number, valDays: number,
    valBlown: boolean,
): Compliance {
    const annBt = annualize(btReturnPct, btDays);
    const annVal = annualize(valReturnPct, valDays);
    const verdict = verdictOf(annVal, annBt, valBlown);
    // Ratio solo tiene sentido si el backtest prometía algo (annBt>0). Puede ser negativo
    // si la validación dio pérdida (bt+ / val− → ratio<0, coherente con FALLA).
    const ratio = annBt > 0 ? (annVal / annBt) * 100 : null;
    return { ratio, verdict, annBt, annVal };
}
