import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4173", viewport: { width: 390, height: 844 } },
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    timeout: 60000,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://heimdall-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    },
  },
});
