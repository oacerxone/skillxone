// Lab measurement of Core Web Vitals-style metrics against a running site.
//   node scripts/measure-vitals.mjs http://127.0.0.1:3000 /path1 /path2 ...
// Desktop: no throttling. Mobile: 375x812, 4x CPU slowdown, 1.6 Mbps down / 750 kbps up, 150 ms RTT.
// Reports median of 3 cold loads per page. INP needs real interactions and is not measured here.
import { chromium } from '@playwright/test';

const [base, ...paths] = process.argv.slice(2);
const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 }, cpu: 1, network: null },
  mobile: {
    viewport: { width: 375, height: 812 },
    cpu: 4,
    network: {
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    },
  },
};

// `collect` runs inside the browser page, not in Node.
/* global PerformanceObserver, performance, setTimeout */
const collect = () =>
  new Promise((resolve) => {
    const out = { lcp: 0, cls: 0, longTasks: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) out.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) out.longTasks += Math.max(0, e.duration - 50);
    }).observe({ type: 'longtask', buffered: true });
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const resources = performance.getEntriesByType('resource');
      const js = resources
        .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
        .reduce((n, r) => n + (r.transferSize || 0), 0);
      const total =
        resources.reduce((n, r) => n + (r.transferSize || 0), 0) + (nav.transferSize || 0);
      resolve({
        ttfb: nav.responseStart,
        fcp: fcp?.startTime ?? 0,
        ...out,
        tbt: out.longTasks,
        jsKB: js / 1024,
        totalKB: total / 1024,
      });
    }, 3000);
  });

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
const rows = [];
for (const [name, profile] of Object.entries(PROFILES)) {
  for (const path of paths) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const context = await browser.newContext({ viewport: profile.viewport });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      if (profile.network)
        await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });
      await page.goto(base + path, { waitUntil: 'load' });
      runs.push(await page.evaluate(collect));
      await context.close();
    }
    const pick = (key) => median(runs.map((r) => r[key]));
    rows.push({
      profile: name,
      path,
      ttfb: Math.round(pick('ttfb')),
      fcp: Math.round(pick('fcp')),
      lcp: Math.round(pick('lcp')),
      cls: pick('cls').toFixed(3),
      tbt: Math.round(pick('tbt')),
      jsKB: Math.round(pick('jsKB')),
      totalKB: Math.round(pick('totalKB')),
    });
  }
}
await browser.close();
console.table(rows);
console.log(JSON.stringify(rows));
