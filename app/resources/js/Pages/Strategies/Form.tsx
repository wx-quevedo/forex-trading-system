import { Head, useForm, Link } from '@inertiajs/react';
import { useMemo, type FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import type { SchemaField, Strategy, StrategySchemas } from '@/types';

interface Props {
    strategy: Strategy | null;
    schemas: StrategySchemas;
    timeframes: string[];
    symbols: string[];
}

function defaultsFor(fields: SchemaField[]): Record<string, number | string> {
    return Object.fromEntries(fields.map((f) => [f.name, f.default]));
}

export default function Form({ strategy, schemas, timeframes, symbols }: Props) {
    const isEdit = Boolean(strategy);
    const types = Object.keys(schemas);
    const initialType = strategy?.parameters?.type ?? types[0] ?? 'ma_cross';

    const { data, setData, post, put, processing, errors } = useForm({
        name: strategy?.name ?? '',
        description: strategy?.description ?? '',
        pair: strategy?.pair ?? 'EURUSD',
        timeframe: strategy?.timeframe ?? 'H1',
        type: initialType,
        indicators:
            strategy?.parameters?.indicators ??
            (schemas[initialType] ? defaultsFor(schemas[initialType].fields) : {}),
        risk: {
            sl_pips: strategy?.parameters?.risk?.sl_pips ?? 20,
            tp_pips: strategy?.parameters?.risk?.tp_pips ?? 40,
            risk_percent: strategy?.parameters?.risk?.risk_percent ?? 1,
        },
        is_active: strategy?.is_active ?? false,
    });

    const activeSchema = schemas[data.type];
    const fields = useMemo(() => activeSchema?.fields ?? [], [activeSchema]);

    const changeType = (type: string) => {
        setData((prev) => ({
            ...prev,
            type,
            // Reinicia los parámetros del indicador a los defaults del nuevo tipo.
            indicators: schemas[type] ? defaultsFor(schemas[type].fields) : {},
        }));
    };

    const setIndicator = (name: string, value: string) => {
        setData('indicators', { ...data.indicators, [name]: value });
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (isEdit && strategy) put(`/strategies/${strategy.id}`);
        else post('/strategies');
    };

    const saveAsVersion = () => {
        if (strategy) post(`/strategies/${strategy.id}/version`);
    };

    return (
        <AppLayout title={isEdit ? `Editar: ${strategy?.name}` : 'Nueva estrategia'}>
            <Head title={isEdit ? 'Editar estrategia' : 'Nueva estrategia'} />

            {types.length === 0 && (
                <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    No se pudieron cargar los tipos de estrategia desde el bridge. Verifica que esté en marcha.
                </div>
            )}

            <form onSubmit={submit} className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Datos generales */}
                <section className="rounded-lg border border-border bg-bg-surface p-5">
                    <h2 className="mb-4 text-sm font-semibold">Datos generales</h2>

                    <Field label="Nombre" error={errors.name}>
                        <input
                            value={data.name}
                            onChange={(e) => setData('name', e.target.value)}
                            className="input"
                        />
                    </Field>

                    <Field label="Descripción" error={errors.description}>
                        <textarea
                            value={data.description ?? ''}
                            onChange={(e) => setData('description', e.target.value)}
                            rows={2}
                            className="input"
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Par" error={errors.pair}>
                            <SymbolCombobox
                                value={data.pair}
                                symbols={symbols}
                                onChange={(s) => setData('pair', s)}
                                placeholder="EURUSD"
                            />
                        </Field>
                        <Field label="Timeframe" error={errors.timeframe}>
                            <select
                                value={data.timeframe}
                                onChange={(e) => setData('timeframe', e.target.value)}
                                className="input font-mono"
                            >
                                {timeframes.map((tf) => (
                                    <option key={tf} value={tf}>
                                        {tf}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                        <input
                            type="checkbox"
                            checked={data.is_active}
                            onChange={(e) => setData('is_active', e.target.checked)}
                        />
                        Activa
                    </label>
                </section>

                {/* Tipo + parámetros dinámicos */}
                <section className="rounded-lg border border-border bg-bg-surface p-5">
                    <h2 className="mb-4 text-sm font-semibold">Tipo y parámetros</h2>

                    <Field label="Tipo de estrategia">
                        <select value={data.type} onChange={(e) => changeType(e.target.value)} className="input">
                            {types.map((t) => (
                                <option key={t} value={t}>
                                    {schemas[t].label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {activeSchema && <p className="-mt-2 mb-3 text-xs text-text-secondary">{activeSchema.description}</p>}

                    <div className="grid grid-cols-2 gap-3">
                        {fields.map((f) => (
                            <Field key={f.name} label={f.label}>
                                {f.type === 'select' ? (
                                    <select
                                        value={String(data.indicators[f.name] ?? f.default)}
                                        onChange={(e) => setIndicator(f.name, e.target.value)}
                                        className="input"
                                    >
                                        {f.options?.map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="number"
                                        min={f.min}
                                        max={f.max}
                                        step={f.step ?? 1}
                                        value={String(data.indicators[f.name] ?? f.default)}
                                        onChange={(e) => setIndicator(f.name, e.target.value)}
                                        className="input font-mono"
                                    />
                                )}
                            </Field>
                        ))}
                    </div>

                    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                        Gestión de riesgo
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="SL (pips)">
                            <input
                                type="number"
                                min={0}
                                value={data.risk.sl_pips ?? ''}
                                onChange={(e) => setData('risk', { ...data.risk, sl_pips: Number(e.target.value) })}
                                className="input font-mono"
                            />
                        </Field>
                        <Field label="TP (pips)">
                            <input
                                type="number"
                                min={0}
                                value={data.risk.tp_pips ?? ''}
                                onChange={(e) => setData('risk', { ...data.risk, tp_pips: Number(e.target.value) })}
                                className="input font-mono"
                            />
                        </Field>
                        <Field label="Riesgo %">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={data.risk.risk_percent ?? ''}
                                onChange={(e) => setData('risk', { ...data.risk, risk_percent: Number(e.target.value) })}
                                className="input font-mono"
                            />
                        </Field>
                    </div>
                </section>

                {/* Acciones */}
                <div className="flex items-center gap-3 lg:col-span-2">
                    <button
                        type="submit"
                        disabled={processing}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {isEdit ? 'Guardar cambios' : 'Crear estrategia'}
                    </button>
                    {isEdit && (
                        <button
                            type="button"
                            onClick={saveAsVersion}
                            disabled={processing}
                            className="rounded-md border border-border px-4 py-2 text-sm text-text-primary hover:bg-bg-elevated disabled:opacity-50"
                        >
                            Guardar como nueva versión
                        </button>
                    )}
                    <Link href={isEdit && strategy ? `/strategies/${strategy.id}` : '/strategies'} className="text-sm text-text-secondary hover:text-text-primary">
                        Cancelar
                    </Link>
                </div>
            </form>
        </AppLayout>
    );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
    return (
        <label className="mb-3 block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">{label}</span>
            {children}
            {error && <span className="mt-1 block text-xs text-loss">{error}</span>}
        </label>
    );
}
