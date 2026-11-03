import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", workers: 1, fullyParallel: false,
  timeout: 45_000, expect: { timeout: 10_000 },
  reporter: "list", outputDir: ".wrangler/access-dev/test-results",
  use: { baseURL: "http://localhost:5173", ...devices["Desktop Chrome"], channel: process.platform === "win32" ? "msedge" : undefined, trace: "retain-on-failure" },
  webServer: [
    { command: "npm run dev", url: "http://localhost:8787/api/auth/me", reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "npm run dev:web", url: "http://localhost:5173", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});
