import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Belem',
  },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } }, testMatch: /desktop\.spec\.ts/ },
  ],
  webServer: {
    command: 'npx tsx e2e/start-server.mts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://clinica:clinica_dev@localhost:5432/clinica_e2e',
      APP_SECRET: 'e2e-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      PUBLIC_URL: `http://localhost:${PORT}`,
      WEB_DIST_DIR: './web/dist',
      UPLOAD_DIR: '/tmp/jrs-e2e-uploads',
      JOBS_INTERVAL_MS: '1500',
      WHATSAPP_PROVIDER: 'manual',
      EMAIL_PROVIDER: 'log',
      LOG_LEVEL: 'warn',
    },
  },
});
