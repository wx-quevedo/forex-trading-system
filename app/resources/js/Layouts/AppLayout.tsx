import { Link, usePage, router } from '@inertiajs/react';
import type { PropsWithChildren } from 'react';
import type { SharedProps } from '@/types';
import BotStatusIndicator from '@/Components/BotStatusIndicator';

const NAV = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/strategies', label: 'Estrategias' },
    { href: '/backtests', label: 'Backtests' },
];

export default function AppLayout({ children, title }: PropsWithChildren<{ title?: string }>) {
    const { props, url } = usePage<SharedProps>();
    const user = props.auth.user;

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <header className="sticky top-0 z-10 border-b border-border bg-bg-surface/80 backdrop-blur">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded bg-accent font-mono text-sm font-bold text-white">
                                F
                            </span>
                            <span className="text-sm font-semibold tracking-tight">ForexBot</span>
                        </div>
                        <nav className="flex items-center gap-1">
                            {NAV.map((item) => {
                                const active = url.startsWith(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                                            active
                                                ? 'bg-bg-elevated text-text-primary'
                                                : 'text-text-secondary hover:text-text-primary'
                                        }`}
                                    >
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="flex items-center gap-5">
                        <BotStatusIndicator status="paused" />
                        {user && (
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-text-secondary">{user.name}</span>
                                <button
                                    type="button"
                                    onClick={() => router.post('/logout')}
                                    className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                                >
                                    Salir
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] px-6 py-6">
                {title && <h1 className="mb-5 text-lg font-semibold tracking-tight">{title}</h1>}
                {children}
            </main>
        </div>
    );
}
