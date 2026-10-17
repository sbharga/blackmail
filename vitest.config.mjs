import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/utils/tests/**/*.test.ts'], environment: 'node' } });
