import { defineConfig } from 'vitest/config';

/**
 * Tests for the web app's own logic.
 *
 * Not for pages or components — those are covered by the build and by driving the real thing. This
 * exists for `lib/`, which by now holds decisions worth pinning: who may do what, and what a search
 * box compiles to. Permission rules with no test are how a role check quietly stops being one.
 */
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['lib/**/*.{test,spec}.{ts,mts,tsx}'],
    reporters: ['default'],
  },
}));
