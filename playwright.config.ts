import { defineConfig, devices } from '@playwright/test';

const api = 'http://127.0.0.1:3317';
const h5 = 'http://127.0.0.1:5179';
export default defineConfig({
  testDir: './tests',
  timeout: 40000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: h5,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{name:'H5 Chromium',use:{...devices['Desktop Chrome']}}],
  webServer: [
    {command:'node --import tsx apps/server/src/index.ts',url:api + '/healthz',env:{
      PORT:'3317',HOST:'127.0.0.1',LIFELOG_MODE:'demo',DEMO_DB_PATH:':memory:',
      AI_API_KEY:'',WECHAT_OA_TOKEN:'',WECHAT_MEDIA_DOWNLOAD:'false',
    },timeout:45000},
    {command:'npm run dev:h5 -w @lifelog/web -- --port 5179',url:h5,env:{VITE_API_PROXY:api,VITE_API_BASE:''},timeout:60000},
  ],
});
