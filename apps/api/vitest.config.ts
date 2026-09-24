import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    /**
     * The default five seconds is comfortable against the in-memory store and too tight against
     * a real one: a test that drives a whole booking through Postgres makes hundreds of round
     * trips. Twenty seconds is still short enough that a genuine hang fails rather than hangs.
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
