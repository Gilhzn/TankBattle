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
  // The search says how long is left rather than spinning silently.
  await expect(page.getByTestId('queue-countdown')).not.toBeEmpty();

  // MATCHMAKING_TIMEOUT_MS is shortened for the e2e server; in production this wait is 20 seconds.
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 30_000 });
  await waitForTicks(page, 20);
  const hook = await readHook(page);
  expect(hook.view.tanks.filter((t) => t[2] === 'player').length).toBeGreaterThanOrEqual(2);

  await ctx.close();
});
