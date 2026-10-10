import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000, pool: 'forks', poolOptions: { forks: { singleFork: true } } },
});
