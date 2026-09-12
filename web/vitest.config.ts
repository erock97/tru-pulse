import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts'],
    environment: 'node',
  },
});
