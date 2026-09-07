import { test, expect } from '@playwright/test';
import { readHook, waitForTicks } from './helpers.js';

test('two browsers create and join a co-op room and both see two tanks', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/#/lobby');
  await a.getByTestId('lobby-create').click();
  const code = (await a.getByTestId('lobby-code').textContent())?.trim().replace(/[^A-Z2-9]/g, '');
  expect(code).toMatch(/^[A-Z2-9]{5}$/);

  await b.goto('/#/lobby');
  await b.getByTestId('lobby-join-code').fill(code!);
  await b.getByTestId('lobby-join').click();
  await expect(a.getByTestId('lobby-players').locator('> *')).toHaveCount(2);
  await expect(b.getByTestId('lobby-players').locator('> *')).toHaveCount(2);

  await a.getByTestId('lobby-start').click();
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
