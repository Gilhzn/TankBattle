import { test, expect } from '@playwright/test';
import { readHook, waitForTicks } from './helpers.js';

test('two players searching for a 1v1 find each other with nobody hosting', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/#/lobby');
  await a.getByTestId('queue-1v1').click();
  // Alone in the queue, the wait is legible: one of the two seats is filled.
  await expect(a.getByTestId('queue-found')).toContainText('1');

  await b.goto('/#/lobby');
  await b.getByTestId('queue-1v1').click();

  // No code was passed between the two browsers, and neither pressed "start".
  await expect(a.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
  await waitForTicks(a, 20);
  await waitForTicks(b, 20);

  const hookA = await readHook(a);
  const hookB = await readHook(b);
  expect(hookA.mode).toBe('online');
  expect(hookB.mode).toBe('online');
  expect(hookA.view.tanks.filter((t) => t[2] === 'player').length).toBe(2);
  expect(hookB.view.tanks.filter((t) => t[2] === 'player').length).toBe(2);

  await ctxA.close();
  await ctxB.close();
});

test('a deathmatch starts anyway when the fourth player never turns up', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/#/lobby');
  await page.getByTestId('queue-ffa').click();
  await expect(page.getByTestId('queue-found')).toContainText('4');
  // The search says what it is doing. It must never say how long is left.
  await expect(page.getByTestId('queue-status')).not.toBeEmpty();
  await expect(page.getByTestId('queue-status')).not.toContainText(/\d/);

  // MATCHMAKING_TIMEOUT_MS pins the e2e wait; in production it is a random 9-17 seconds.
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 30_000 });
  await waitForTicks(page, 20);
  const hook = await readHook(page);
  expect(hook.view.tanks.filter((t) => t[2] === 'player').length).toBeGreaterThanOrEqual(2);

  await ctx.close();
});

test('four players fit the HUD without eating the map', async ({ browser }) => {
  test.setTimeout(90_000);
  // A phone viewport, because that is where a HUD row costs map: the field is sized from whatever
  // height the HUD leaves behind.
  const contexts = [];
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('/#/lobby');
    await page.getByTestId('queue-ffa').click();
    contexts.push(ctx);
    pages.push(page);
  }
  const a = pages[0];
  await expect(a.getByTestId('game-canvas')).toBeVisible({ timeout: 30_000 });
  await waitForTicks(a, 10);

  const hud = await a.evaluate(() => {
    const strip = document.querySelector('.hud-lives')!.getBoundingClientRect();
    const canvas = document.querySelector('.game-canvas')!.getBoundingClientRect();
    return {
      chips: document.querySelectorAll('.hud-player').length,
      stripHeight: Math.round(strip.height),
      hudHeight: Math.round(document.querySelector('.hud')!.getBoundingClientRect().height),
      canvasWidth: Math.round(canvas.width),
      scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(hud.chips).toBe(4);
  // One chip per player stacked full-width was 131px of strip and 203px of HUD; the map was 278px
  // wide on this viewport. The numbers are what the player actually feels here, so assert them.
  expect(hud.stripHeight).toBeLessThanOrEqual(80);
  expect(hud.hudHeight).toBeLessThanOrEqual(140);
  expect(hud.canvasWidth).toBe(412);
  expect(hud.scrollsSideways).toBe(false);

  // Turned sideways the arena is a square in a wide window, and the HUD moves into the empty
  // gutters either side of it. Nothing it draws may end up on top of the map.
  await a.setViewportSize({ width: 740, height: 412 });
  await a.waitForTimeout(600);
  const landscape = await a.evaluate(() => {
    const canvas = document.querySelector('.game-canvas')!.getBoundingClientRect();
    const over: string[] = [];
    for (const el of document.querySelectorAll('.hud-row, .hud-player, .hud-btn, .hud-stage, .hud-enemies')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const w = Math.min(r.right, canvas.right) - Math.max(r.left, canvas.left);
      const h = Math.min(r.bottom, canvas.bottom) - Math.max(r.top, canvas.top);
      if (w > 1 && h > 1) over.push(el.className.trim());
    }
    return { over, chips: document.querySelectorAll('.hud-player').length, canvasWidth: Math.round(canvas.width) };
  });
  expect(landscape.chips).toBe(4);
  expect(landscape.over).toEqual([]);
  expect(landscape.canvasWidth).toBe(412);

  for (const ctx of contexts) await ctx.close();
});
