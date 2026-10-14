import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',timeout:150000,workers:1,retries:0,
  use:{actionTimeout:10000,baseURL:process.env.TEST_ORIGIN||'http://127.0.0.1:3100',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
  reporter:[['list'],['json',{outputFile:'test-results/results.json'}]],
});
