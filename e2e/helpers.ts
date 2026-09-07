import { expect, type Page } from '@playwright/test';

export interface TankHook {
  view: { t: number; tanks: Array<[number, number, string, number, number, number]>; players: Array<{ slot: number; lives: number; score: number }>; status: string; stage: number };
  tick: number;
  mode: string;
  screen: string;
}

export async function readHook(page: Page): Promise<TankHook> {
  return page.evaluate(() => {
    const h = (window as unknown as { __tank?: TankHook }).__tank;
    if (!h) throw new Error('window.__tank missing');
    return { view: h.view, tick: h.tick, mode: h.mode, screen: h.screen } as TankHook;
  });
}

export async function playerTankY(page: Page, slot = 0): Promise<number> {
  const hook = await readHook(page);
  const tank = hook.view.tanks.find((t) => t[1] === slot && t[2] === 'player');
  if (!tank) throw new Error(`no tank for slot ${slot}`);
  return tank[4];
}

export async function waitForTicks(page: Page, minTick: number): Promise<void> {
  await expect.poll(async () => (await readHook(page)).tick, { timeout: 15_000 }).toBeGreaterThan(minTick);
}
