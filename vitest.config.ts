import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cada pacote tem seu vitest.config.ts; supabase/ guarda os testes de RLS
    // (rodam contra o Supabase local).
    projects: ['apps/*', 'packages/*', 'scripts', 'supabase'],
    passWithNoTests: true,
  },
});
