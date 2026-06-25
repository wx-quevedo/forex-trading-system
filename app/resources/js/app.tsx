import './bootstrap';
import '../css/app.css';

import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';

const appName = import.meta.env.VITE_APP_NAME || 'ForexBot';
const pages = import.meta.glob<{ default: ComponentType }>('./Pages/**/*.tsx');

createInertiaApp({
    title: (title) => (title ? `${title} · ${appName}` : appName),
    resolve: async (name) => {
        const page = pages[`./Pages/${name}.tsx`];
        if (!page) throw new Error(`Página Inertia no encontrada: ${name}`);
        return (await page()).default;
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
    },
    progress: {
        color: '#2962FF',
    },
});
