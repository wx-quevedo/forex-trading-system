import { useForm, Head } from '@inertiajs/react';
import type { FormEvent } from 'react';

export default function Login() {
    const { data, setData, post, processing, errors } = useForm({
        email: '',
        password: '',
        remember: false,
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        post('/login');
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
            <Head title="Iniciar sesión" />
            <div className="w-full max-w-sm">
                <div className="mb-8 flex items-center justify-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded bg-accent font-mono text-lg font-bold text-white">
                        F
                    </span>
                    <span className="text-xl font-semibold tracking-tight">ForexBot</span>
                </div>

                <form onSubmit={submit} className="rounded-xl border border-border bg-bg-surface p-6">
                    <label className="block">
                        <span className="text-xs uppercase tracking-wide text-text-secondary">Email</span>
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => setData('email', e.target.value)}
                            autoFocus
                            className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
                        />
                        {errors.email && <p className="mt-1 text-xs text-loss">{errors.email}</p>}
                    </label>

                    <label className="mt-4 block">
                        <span className="text-xs uppercase tracking-wide text-text-secondary">Contraseña</span>
                        <input
                            type="password"
                            value={data.password}
                            onChange={(e) => setData('password', e.target.value)}
                            className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
                        />
                        {errors.password && <p className="mt-1 text-xs text-loss">{errors.password}</p>}
                    </label>

                    <label className="mt-4 flex items-center gap-2 text-xs text-text-secondary">
                        <input
                            type="checkbox"
                            checked={data.remember}
                            onChange={(e) => setData('remember', e.target.checked)}
                            className="rounded border-border bg-bg-elevated"
                        />
                        Recordarme
                    </label>

                    <button
                        type="submit"
                        disabled={processing}
                        className="mt-6 w-full rounded-md bg-accent py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {processing ? 'Entrando…' : 'Iniciar sesión'}
                    </button>
                </form>
            </div>
        </div>
    );
}
