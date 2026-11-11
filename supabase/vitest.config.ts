import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Os testes de RLS compartilham o mesmo banco local: rodar em série.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
