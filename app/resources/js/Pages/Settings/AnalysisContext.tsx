import { Head, useForm } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';

interface Props {
    context: { date_from: string; date_to: string; capital: number; val_date_from: string; val_date_to: string };
}

export default function AnalysisContext({ context }: Props) {
    const form = useForm({
        date_from: context.date_from,
        date_to: context.date_to,
        capital: context.capital,
        val_date_from: context.val_date_from,
        val_date_to: context.val_date_to,
    });
    const overlap = form.data.val_date_from < form.data.date_to;  // bloqueo visual del solape

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.post('/settings/analysis-context', { preserveScroll: true });
    };

    return (
        <AppLayout title="Contexto de análisis">
            <Head title="Contexto de análisis" />

            <div className="mx-auto max-w-xl">
                <p className="mb-4 text-sm text-text-secondary">
                    Esta es la <span className="font-semibold text-text-primary">marca global</span> de análisis: el
                    Explorador y el Mapa de cobertura usan SIEMPRE este periodo y capital (fijos, no editables en cada
                    búsqueda). Así el caché acierta y los análisis son consistentes.
                </p>

                <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-bg-surface p-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Desde">
                            <input type="date" value={form.data.date_from} onChange={(e) => form.setData('date_from', e.target.value)} className="input font-mono" />
                        </Field>
                        <Field label="Hasta">
                            <input type="date" value={form.data.date_to} onChange={(e) => form.setData('date_to', e.target.value)} className="input font-mono" />
                        </Field>
                        <Field label="Capital inicial (USD)">
                            <input type="number" min={1} step={100} value={form.data.capital} onChange={(e) => form.setData('capital', Number(e.target.value))} className="input font-mono" />
                        </Field>
                    </div>

                    <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">Rango de validación walk-forward (posterior, sin solape)</div>
                        <p className="mb-2 text-xs text-text-secondary">Datos POSTERIORES que el Explorador no optimiza. El botón "Validar top-N" recalcula las mejores candidatas aquí y las compara con su backtest. Debe empezar en o después del fin de la optimización.</p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Validación desde">
                                <input type="date" value={form.data.val_date_from} onChange={(e) => form.setData('val_date_from', e.target.value)} className="input font-mono" />
                            </Field>
                            <Field label="Validación hasta">
                                <input type="date" value={form.data.val_date_to} onChange={(e) => form.setData('val_date_to', e.target.value)} className="input font-mono" />
                            </Field>
                        </div>
                    </div>

                    {overlap && (
                        <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
                            La validación SOLAPA con la optimización (empieza antes del {form.data.date_to}). Eso falsearía el walk-forward con datos ya vistos — no se permite. Ajusta el rango.
                        </div>
                    )}

                    {(form.errors.date_from || form.errors.date_to || form.errors.capital || form.errors.val_date_from || form.errors.val_date_to) && (
                        <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
                            {form.errors.date_from || form.errors.date_to || form.errors.capital || form.errors.val_date_from || form.errors.val_date_to}
                        </div>
                    )}

                    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                        Cambiar el contexto hará que el Explorador y el Mapa reflejen el nuevo periodo+capital. Lo ya
                        calculado con el contexto anterior sigue en caché, pero el mapa contará sobre el contexto nuevo.
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="submit" disabled={form.processing || overlap} className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                            Guardar contexto
                        </button>
                        {form.recentlySuccessful && <span className="text-sm text-profit">Guardado.</span>}
                    </div>
                </form>

                <p className="mt-4 text-center font-mono text-xs text-text-secondary">
                    Contexto activo: {form.data.date_from} → {form.data.date_to} · ${Number(form.data.capital).toLocaleString()}
                </p>
            </div>
        </AppLayout>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>;
}
