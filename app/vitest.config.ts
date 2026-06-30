import { defineConfig } from 'vitest/config';

// Solo nuestros tests de frontend (resources/js). Excluye vendor/ (dependencias PHP de
// Composer que traen sus propios *.test.ts) y node_modules.
export default defineConfig({
    test: {
        include: ['resources/js/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['node_modules', 'vendor'],
    },
});
