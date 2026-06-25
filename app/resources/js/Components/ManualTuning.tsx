import { router } from '@inertiajs/react';
import { useState } from 'react';
import type { DiffRow } from '@/types';

interface Preview {
    diff: DiffRow[];
    diagnostico: string | null;
    justificacion: string | null;
    confianza: string | null;
}

export default function ManualTuning({ backtestId, prompt }: { backtestId: number; prompt: string }) {
    const [copied, setCopied] = useState(false);
    const [pasted, setPasted] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* algunos navegadores requieren https; el usuario puede copiar a mano */
        }
    };

    const validate = async () => {
        if (!pasted.trim()) return;
        setBusy(true);
        setErrors([]);
        setPreview(null);
        try {
            const { data } = await window.axios.post(`/backtests/${backtestId}/manual/preview`, { json: pasted });
            setPreview(data as Preview);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { errors?: string[]; message?: string } } };
            setErrors(err.response?.data?.errors ?? [err.response?.data?.message ?? 'No se pudo validar el JSON.']);
        } finally {
            setBusy(false);
        }
    };

    const confirm = () => {
        router.post(`/backtests/${backtestId}/manual/apply`, { json: pasted });
    };

    return (
        <div className="space-y-6">
            {/* Paso 1: prompt para copiar */}
            <section className="rounded-lg border border-border bg-bg-surface p-4">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                        Paso 1 · Copia este prompt y pégalo en Claude.ai
                    </h2>
                    <button
                        type="button"
                        onClick={copy}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                        {copied ? 'Copiado ✓' : 'Copiar'}
                    </button>
                </div>
                <textarea
                    readOnly
                    value={prompt}
                    rows={12}
                    className="w-full resize-y rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs text-text-secondary"
                    onFocus={(e) => e.currentTarget.select()}
                />
            </section>

            {/* Paso 2: pegar respuesta */}
            <section className="rounded-lg border border-border bg-bg-surface p-4">
                <h2 className="mb-2 text-sm font-semibold">
                    Paso 2 · Pega aquí la respuesta JSON de Claude
                </h2>
                <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={8}
                    placeholder='{ "diagnostico": "...", "parametros_sugeridos": { ... }, "riesgo_sugerido": { ... } }'
                    className="w-full resize-y rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs text-text-primary outline-none focus:border-accent"
                />
                <div className="mt-3 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={validate}
                        disabled={busy || !pasted.trim()}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {busy ? 'Validando…' : 'Validar y previsualizar'}
                    </button>
                </div>

                {errors.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-md border border-loss/40 bg-loss/10 p-3 text-xs text-loss">
                        {errors.map((er, i) => (
                            <li key={i}>· {er}</li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Diff + confirmación */}
            {preview && (
                <section className="rounded-lg border border-accent/30 bg-bg-surface p-4">
                    <h2 className="mb-3 text-sm font-semibold">Cambios propuestos</h2>

                    {preview.diagnostico && (
                        <p className="mb-3 text-sm text-text-secondary">
                            <span className="font-semibold text-text-primary">Diagnóstico: </span>
                            {preview.diagnostico}
                        </p>
                    )}

                    <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                    <th className="px-3 py-2 font-medium">Parámetro</th>
                                    <th className="px-3 py-2 font-medium">Grupo</th>
                                    <th className="px-3 py-2 font-medium text-right">Antes</th>
                                    <th className="px-3 py-2 font-medium text-right">Después</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.diff.map((r) => (
                                    <tr key={`${r.group}-${r.key}`} className="border-b border-border/40 last:border-0">
                                        <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{r.key}</td>
                                        <td className="px-3 py-1.5 text-xs text-text-secondary">{r.group}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary line-through">
                                            {r.old ?? '—'}
                                        </td>
                                        <td
                                            className={`px-3 py-1.5 text-right font-mono text-xs ${
                                                r.changed ? 'font-semibold text-accent' : 'text-text-secondary'
                                            }`}
                                        >
                                            {r.new ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {preview.justificacion && (
                        <p className="mt-3 text-xs text-text-secondary">
                            <span className="font-semibold text-text-primary">Justificación: </span>
                            {preview.justificacion}
                            {preview.confianza && <span className="ml-2 text-text-secondary">(confianza: {preview.confianza})</span>}
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={confirm}
                        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    >
                        Crear nueva versión
                    </button>
                </section>
            )}
        </div>
    );
}
