import { defineConfig, devices } from "@playwright/test";

const port = 3010;
const dataDir = process.env.NEXTFLOW_STUDIO_DATA_DIR ?? "/tmp/nextflow-studio-e2e";
const useDev = !process.env.CI && process.env.E2E_DEV !== "0";

process.env.NEXTFLOW_STUDIO_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash scripts/e2e-serve.sh",
    url: `http://127.0.0.1:${port}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXTFLOW_STUDIO_DATA_DIR: dataDir,
      NEXT_PUBLIC_API_MOCKING: "disabled",
      NXF_DISABLE_CHECK_LATEST: "true",
      NXF_ANSI_LOG: "false",
      E2E_DEV: useDev ? "1" : "0",
      E2E_PORT: String(port),
    },
  },
});
