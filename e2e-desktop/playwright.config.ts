import { defineConfig } from "@playwright/test";

/**
 * Packaged-app acceptance: launches the built Electron app (not the dev server) with Playwright's Electron
 * driver. Build first with `pnpm --dir desktop dist:linux` (or dist:mac); DESKTOP_APP overrides the binary.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never", outputFolder: "../playwright-report-desktop" }]] : "list",
  outputDir: "../test-results/desktop",
  use: { actionTimeout: 15_000, navigationTimeout: 60_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
