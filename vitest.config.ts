import { defineConfig } from "vitest/config";

/**
 * Unit tests live under `tests/unit/` to avoid picking up:
 *  - `tests/e2e/*.spec.ts` (Playwright, different test runner)
 *  - `tests/rls.test.ts`, `tests/seed-and-auth.test.ts` (standalone node scripts
 *    that connect to a real Supabase project — must be invoked manually).
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": new URL("./src", import.meta.url).pathname,
    },
  },
});
