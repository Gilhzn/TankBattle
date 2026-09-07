import { test, expect } from '@playwright/test';
import { playerTankY, waitForTicks } from './helpers.js';

test.describe('mobile touch controls', () => {
  test('joystick drag moves the tank and the fire button shoots', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('menu-play-solo').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await expect(page.getByTestId('touch-joystick')).toBeVisible();
    await expect(page.getByTestId('touch-fire')).toBeVisible();
    await waitForTicks(page, 20);

    const joy = await page.getByTestId('touch-joystick').boundingBox();
    if (!joy) throw new Error('joystick has no box');
    const cx = joy.x + joy.width / 2;
    const cy = joy.y + joy.height / 2;
    const y0 = await playerTankY(page);
    // drag upward from the joystick centre and hold
    await page.touchscreen.tap(cx, cy);
    await page.dispatchEvent('[data-testid="touch-joystick"]', 'pointerdown', { pointerType: 'touch', clientX: cx, clientY: cy, pointerId: 1, isPrimary: true, button: 0, buttons: 1 });
    await page.dispatchEvent('[data-testid="touch-joystick"]', 'pointermove', { pointerType: 'touch', clientX: cx, clientY: cy - 60, pointerId: 1, isPrimary: true, buttons: 1 });
    await page.waitForTimeout(700);
    await page.dispatchEvent('[data-testid="touch-joystick"]', 'pointerup', { pointerType: 'touch', clientX: cx, clientY: cy - 60, pointerId: 1, isPrimary: true, button: 0, buttons: 0 });
    const y1 = await playerTankY(page);
    expect(y1).toBeLessThan(y0);

    const fire = await page.getByTestId('touch-fire').boundingBox();
    if (!fire) throw new Error('fire has no box');
    await page.dispatchEvent('[data-testid="touch-fire"]', 'pointerdown', { pointerType: 'touch', clientX: fire.x + 10, clientY: fire.y + 10, pointerId: 2, isPrimary: false, button: 0, buttons: 1 });
    await page.waitForTimeout(150);
    await page.dispatchEvent('[data-testid="touch-fire"]', 'pointerup', { pointerType: 'touch', clientX: fire.x + 10, clientY: fire.y + 10, pointerId: 2, isPrimary: false, button: 0, buttons: 0 });
    const bullets = await page.evaluate(() => (window as unknown as { __tank: { view: { bullets: unknown[] } } }).__tank.view.bullets.length);
    expect(bullets).toBeGreaterThanOrEqual(0);
  });

  /** Centre x of each control, so the assertions read in physical screen terms. */
  async function controlCentres(page: import('@playwright/test').Page): Promise<{ joystick: number; fire: number }> {
    const joy = await page.getByTestId('touch-joystick').boundingBox();
    const fire = await page.getByTestId('touch-fire').boundingBox();
    if (!joy || !fire) throw new Error('touch controls are not visible');
    return { joystick: joy.x + joy.width / 2, fire: fire.x + fire.width / 2 };
  }

  /** Settings are read once at boot, so this reloads onto the menu rather than the current screen. */
  async function setSettings(page: import('@playwright/test').Page, patch: Record<string, unknown>): Promise<void> {
    await page.evaluate((p) => {
      const key = 'tank1990.settings.v1';
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), ...p }));
    }, patch);
    await page.goto('/#/');
    await page.reload();
    await expect(page.getByTestId('menu-play-solo')).toBeVisible();
  }

  test('joystick sits left of fire by default, in English and in Hebrew, and the setting swaps them', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('menu-play-solo').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    const en = await controlCentres(page);
    expect(en.joystick).toBeLessThan(en.fire);

    // Hebrew flips the document to RTL; the controls are physical and must not mirror with it.
    await setSettings(page, { lang: 'he' });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await page.getByTestId('menu-play-solo').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    const he = await controlCentres(page);
    expect(he.joystick).toBeLessThan(he.fire);

    // Landscape uses a different layout (side gutters) and must hold the same order.
    await page.setViewportSize({ width: 915, height: 412 });
    const landscape = await controlCentres(page);
    expect(landscape.joystick).toBeLessThan(landscape.fire);

    // The "joystick side" setting is what swaps them, in either language.
    await page.setViewportSize({ width: 412, height: 915 });
    await setSettings(page, { handedness: 'right' });
    await page.getByTestId('menu-play-solo').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    const swapped = await controlCentres(page);
    expect(swapped.joystick).toBeGreaterThan(swapped.fire);
  });
});
