import {defineConfig} from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs',
  timeout: 300_000,
  workers: 1,
  retries: isCI ? 1 : 0,
  use: {baseURL: 'http://localhost:3001', trace: 'retain-on-failure'},
  webServer: [
    {
      command: 'pnpm --filter @editorial-motion/api exec tsx src/server.ts',
      env: {PORT: '3000'},
      reuseExistingServer: !isCI,
    },
    {
      command: 'pnpm --filter @editorial-motion/web dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
