import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", timeout: 45000, fullyParallel: false, workers: 1,
  use: { baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3000", browserName: "chromium", launchOptions: { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["list"]]
});
