import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
    },
  },
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: {height: 820, width: 1280},
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  reporter: "list",
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:8210",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:8210",
  },
});
