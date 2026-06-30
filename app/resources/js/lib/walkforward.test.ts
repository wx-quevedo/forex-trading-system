import { describe, expect, it } from 'vitest';
import { annualize, compliance, verdictOf } from './walkforward';

describe('verdictOf', () => {
    it('CUMPLE cuando logra >=70% de lo prometido y sigue en positivo', () => {
        expect(verdictOf(18, 20, false)).toBe('cumple');   // 90% del esperado
        expect(verdictOf(20, 20, false)).toBe('cumple');
    });
    it('SE DEGRADA cuando rinde positivo pero <70% de lo prometido', () => {
        expect(verdictOf(10, 20, false)).toBe('degrada');  // 50%
    });
    it('FALLA cuando pierde o quiebra en datos nuevos (prometiendo positivo)', () => {
        expect(verdictOf(-5, 20, false)).toBe('falla');    // val negativo
        expect(verdictOf(15, 20, true)).toBe('falla');     // quiebra
    });
    it('sin referencia (N/A) cuando el backtest no prometía nada (<=0)', () => {
        expect(verdictOf(50, 0, false)).toBe('na');
        expect(verdictOf(50, -10, false)).toBe('na');
    });
});

describe('compliance (prometido backtest vs logrado validación, anualizados)', () => {
    it('caso ma_cross: prometía +74% y la validación dio -76% → FALLA y ratio negativo', () => {
        // Backtest +74% en ~365 días; validación -76% en ~180 días (rango posterior).
        const c = compliance(74, 365, -76, 180, false);
        expect(c.verdict).toBe('falla');
        expect(c.ratio).not.toBeNull();
        expect(c.ratio!).toBeLessThan(0);   // bt+ / val- → cumplimiento negativo
    });

    it('backtest <=0 → ratio null (N/A): no hay nada que validar', () => {
        const c = compliance(-5, 365, 10, 180, false);
        expect(c.ratio).toBeNull();
        expect(c.verdict).toBe('na');
    });

    it('estrategia honesta que se degrada pero sigue rentable → SE DEGRADA, no FALLA', () => {
        // +20% anualizado prometido; logra +12% anualizado (60%): rinde menos pero positivo.
        const c = compliance(20, 365, 6, 182.5, false);  // 6% en medio año ~= 12% anualizado
        expect(c.verdict).toBe('degrada');
        expect(c.ratio!).toBeGreaterThan(0);
    });

    it('anualiza ambos lados (periodos de distinta duración son comparables)', () => {
        // 10% en 182.5 días ≈ 20% anualizado; prometido 20% en 365 días = 20% anualizado → 100%.
        expect(annualize(10, 182.5)).toBeCloseTo(20, 5);
        const c = compliance(20, 365, 10, 182.5, false);
        expect(c.ratio!).toBeCloseTo(100, 0);
        expect(c.verdict).toBe('cumple');
    });
});
