import { defineConfig } from "@playwright/test";

/**
 * Playwright config for Ada11 e2e auth tests.
 *
 * The dev server is expected to already be running on http://localhost:8081
 * (the user starts it manually via `npm run web`). Playwright does NOT manage
 * the server lifecycle here — see docs/development.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // auth tests share user lifecycle; keep them sequential
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8081",
    headless: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
