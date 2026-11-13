import { defineConfig } from 'vitest/config';

// Testes contra o Supabase REMOTO (ambiente de demonstração). Fora do `pnpm test`:
// rodam só com `pnpm test:remote` e as variáveis do remoto definidas.
export default defineConfig({
  test: {
    name: 'remote',
    root: 'supabase/remote-tests',
    include: ['**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
