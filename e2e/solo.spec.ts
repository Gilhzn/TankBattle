import { test, expect } from '@playwright/test';
import { dismissDailyReward, playerTankY, readHook, waitForTicks } from './helpers.js';

test.describe('solo play', () => {
  test('boots to the menu, starts a solo game, renders and responds to keyboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('menu-play-solo')).toBeVisible();
    await dismissDailyReward(page);
    await page.getByTestId('menu-play-solo').click();
    const canvas = page.getByTestId('game-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('hud-stage')).toContainText('1');
    await waitForTicks(page, 30);

    const before = await canvas.screenshot();
    const y0 = await playerTankY(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const y1 = await playerTankY(page);
    expect(y1).toBeLessThan(y0);

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);

    const hook = await readHook(page);
    expect(hook.mode).toBe('local');
    expect(hook.view.status).toBe('playing');
    await expect(page.getByTestId('hud-enemies')).toBeVisible();
    await expect(page.getByTestId('hud-lives')).toBeVisible();
  });

  test('store and profile load from the API', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('menu-store')).toBeVisible();
    await dismissDailyReward(page);
    await page.getByTestId('menu-store').click();
    await expect(page.getByTestId('store-item-gems_550')).toBeVisible();
    await page.getByTestId('store-tab-boosts').click();
    await expect(page.getByTestId('store-item-boost_grenade')).toBeVisible();
  });
});
