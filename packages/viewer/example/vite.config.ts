import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Exemplo isolado do viewer, com status falsos e sem Supabase.
// O GLB vem de scripts/out (gere com `pnpm model:generate`).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../scripts/out', import.meta.url)),
  plugins: [react()],
  server: {
    host: true, // escuta em 0.0.0.0: acessível pelo celular na rede local
    port: 5174,
    strictPort: true,
  },
  preview: { host: true, port: 5174, strictPort: true },
});
