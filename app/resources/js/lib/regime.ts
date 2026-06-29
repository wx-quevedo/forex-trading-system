// Régimen de mercado (Fase 3): etiquetas, colores y MATCH/MISMATCH estrategia↔régimen.
import type { RegimeLabel } from '@/types';

export interface RegimeMeta {
    label: string;       // etiqueta corta para badges
    long: string;        // nombre completo
    klass: 'trend' | 'range' | 'volatile';
    badge: string;       // clases tailwind para el badge
    help: string;        // tooltip
}

export const REGIME_META: Record<RegimeLabel, RegimeMeta> = {
    TENDENCIA_ALCISTA: {
        label: 'Tendencia ↑', long: 'Tendencia alcista', klass: 'trend',
        badge: 'bg-profit/15 text-profit border border-profit/30',
        help: 'El precio avanzó de forma direccional al alza durante el periodo (alta direccionalidad y ADX). Favorece estrategias de tendencia.',
    },
    TENDENCIA_BAJISTA: {
        label: 'Tendencia ↓', long: 'Tendencia bajista', klass: 'trend',
        badge: 'bg-loss/15 text-loss border border-loss/30',
        help: 'El precio cayó de forma direccional durante el periodo. Favorece estrategias de tendencia (en corto).',
    },
    RANGO: {
        label: 'Rango', long: 'Rango / lateral', klass: 'range',
        badge: 'bg-accent/15 text-accent border border-accent/30',
        help: 'El precio osciló sin dirección neta (baja direccionalidad). Favorece estrategias de reversión a la media (RSI, Bollinger).',
    },
    VOLATIL: {
        label: 'Volátil', long: 'Volátil', klass: 'volatile',
        badge: 'bg-warning/15 text-warning border border-warning/30',
        help: 'Volatilidad anómalamente alta sin dirección limpia. Riesgo elevado para casi cualquier estrategia; usar con cautela.',
    },
};

// Régimen idóneo por tipo de estrategia.
//  reversión/rango: rsi, bollinger · tendencia: ma_cross, macd (+ futuras
//  supertrend/ichimoku/donchian) · combined: mixto (compatible con ambos).
// Tendencia: ma_cross, macd, supertrend, ichimoku, donchian, psar.
// Reversión/rango: rsi, bollinger.
// Mixto/NEUTRO (idealRegimeOf → 'any'): combined, stochastic, cci — ambivalentes
//   (reversión en rango o momentum de continuación), no se fuerza MATCH/MISMATCH.
const TREND_TYPES = new Set(['ma_cross', 'macd', 'supertrend', 'ichimoku', 'donchian', 'psar']);
const RANGE_TYPES = new Set(['rsi', 'bollinger']);

export function idealRegimeOf(type: string): 'trend' | 'range' | 'any' {
    if (TREND_TYPES.has(type)) return 'trend';
    if (RANGE_TYPES.has(type)) return 'range';
    return 'any'; // combined u otros
}

export type MatchVerdict = 'MATCH' | 'MISMATCH' | 'CAUTION' | 'NEUTRO' | null;

export interface MatchResult {
    verdict: MatchVerdict;
    label: string;
    badge: string;
    help: string;
}

export function matchVerdict(type: string, regime: RegimeLabel | null | undefined): MatchResult {
    if (!regime) return { verdict: null, label: '—', badge: 'text-text-secondary', help: 'Régimen no disponible para este periodo.' };
    const meta = REGIME_META[regime];
    const ideal = idealRegimeOf(type);
    if (meta.klass === 'volatile') {
        return { verdict: 'CAUTION', label: 'Cautela', badge: 'bg-warning/15 text-warning border border-warning/30',
            help: 'Periodo volátil: ninguna estrategia tiene ventaja clara. Resultados poco fiables.' };
    }
    if (ideal === 'any') {
        return { verdict: 'NEUTRO', label: 'Neutro', badge: 'bg-bg-secondary text-text-secondary border border-border',
            help: 'Estrategia mixta: compatible tanto con tendencia como con rango.' };
    }
    if (ideal === meta.klass) {
        return { verdict: 'MATCH', label: 'Match', badge: 'bg-profit/15 text-profit border border-profit/30',
            help: `La estrategia (${ideal === 'trend' ? 'tendencia' : 'reversión'}) coincide con el régimen del periodo: condiciones idóneas.` };
    }
    return { verdict: 'MISMATCH', label: 'Mismatch', badge: 'bg-loss/15 text-loss border border-loss/30',
        help: `La estrategia (${ideal === 'trend' ? 'tendencia' : 'reversión'}) NO encaja con el régimen del periodo. Esto explica por qué una estrategia "buena" puede fallar aquí.` };
}

export function regimeLabel(regime: RegimeLabel | null | undefined): string {
    return regime ? REGIME_META[regime].label : '—';
}
