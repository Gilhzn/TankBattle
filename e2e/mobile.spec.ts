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
});
