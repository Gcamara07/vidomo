import { defineProject } from 'vitest/config';

// Edge Functions: só a lógica pura (sem Deno nem banco). O envio de verdade é testado
// ponta a ponta com o Supabase local (ver README, "Notificações").
export default defineProject({
  test: {
    name: 'functions',
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
