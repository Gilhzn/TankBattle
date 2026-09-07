import { test, expect } from '@playwright/test';

test('PWA manifest and service worker are wired up', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const res = await page.request.get(manifestHref!);
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
  const sw = await page.request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return reg ? 'ready' : 'none';
  });
  expect(['ready', 'unsupported']).toContain(registered);
});
