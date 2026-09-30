import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome', viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 19.4326, longitude: -99.1332, accuracy: 12 } },
  webServer: [
    { command: `${process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'} -B -m uvicorn app.main:app --host 127.0.0.1 --port 18081`, cwd: '../backend', url: 'http://127.0.0.1:18081', reuseExistingServer: false, env: { PYTHONDONTWRITEBYTECODE: '1' } },
    { command: 'npm run build && npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:18081', VITE_API_URL: '', VITE_WS_URL: '/ws', DEV_HTTPS_CERT: '', DEV_HTTPS_KEY: '' } },
  ],
})
