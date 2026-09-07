import { test, expect, type Page } from '@playwright/test';
import { dismissDailyReward } from './helpers.js';

/**
 * Two independent browser contexts stand in for two players, since a friendship needs two accounts
 * and each guest account is keyed to its own device token.
 */
async function openAs(page: Page, nickname: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('menu-play-solo')).toBeVisible();
  await dismissDailyReward(page);
  // Claim a nickname so the other player has something to address a request to.
  await page.getByTestId('menu-settings').click();
  const field = page.getByTestId('settings-nickname');
  await field.waitFor();
  await field.fill(nickname);
  await page.getByTestId('settings-save-nickname').click();
  await expect(page.getByTestId('toasts')).toBeVisible({ timeout: 8000 });
  await page.goto('/#/');
}

test.describe('friends', () => {
  test('one player adds another by nickname and both see the friendship', async ({ browser }) => {
    // Two full browser contexts, two account set-ups and a round trip each way: this one needs
    // more than the default budget.
    test.setTimeout(150_000);
    const suffix = String(Date.now() % 100000);
    const alice = `Alice${suffix}`;
    const bob = `Bob${suffix}`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await openAs(pageA, alice);
      await openAs(pageB, bob);

      // Alice sends the request.
      await pageA.getByTestId('menu-friends').click();
      await expect(pageA.getByTestId('friends-body')).toBeVisible();
      await pageA.getByTestId('friends-tab-add').click();
      await pageA.getByTestId('friend-nickname').fill(bob);
      await pageA.getByTestId('friend-send').click();
      await expect(pageA.getByTestId('toasts')).toContainText(bob, { timeout: 8000 });

      // Bob sees it waiting and accepts.
      await pageB.getByTestId('menu-friends').click();
      await pageB.getByTestId('friends-tab-requests').click();
      const accept = pageB.getByTestId(`accept-${alice}`);
      await expect(accept).toBeVisible({ timeout: 8000 });
      await accept.click();

      // Bob's list now shows Alice. The friends screen refetches on every tab switch, so this is
      // live data rather than what was on screen when the request arrived.
      await pageB.getByTestId('friends-tab-list').click();
      const bobsRow = pageB.getByTestId(`friend-${alice}`);
      await expect(bobsRow).toBeVisible({ timeout: 8000 });
      // Alice has the game open, so she must not read as offline on Bob's side.
      await expect(bobsRow).not.toContainText('Offline');

      // ...and the friendship is mutual: Alice's list shows Bob without her having to do anything.
      await pageA.getByTestId('friends-tab-requests').click();
      await pageA.getByTestId('friends-tab-list').click();
      await expect(pageA.getByTestId(`friend-${bob}`)).toBeVisible({ timeout: 8000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('the profile shows a starting rating and an unranked position', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('menu-play-solo')).toBeVisible();
    await dismissDailyReward(page);
    await page.getByTestId('menu-profile').click();
    await expect(page.getByTestId('profile-tier')).toBeVisible({ timeout: 8000 });
    // A brand new account starts at 1000 and is not on the ladder until it plays ranked.
    await expect(page.getByTestId('profile-tier')).toContainText('1000');
    await expect(page.getByTestId('profile-body')).toContainText('—');
  });

  test('sign-in offers email and reports Google as unavailable when unconfigured', async ({ page }) => {
    await page.goto('/#/signin');
    await expect(page.getByTestId('signin-email')).toBeVisible({ timeout: 8000 });
    // This server has no GOOGLE_CLIENT_ID, so the Google panel must not be offered at all.
    await expect(page.getByTestId('signin-google')).toHaveCount(0);
    // And it says plainly that throwaway addresses are refused, before the player types one.
    await expect(page.getByTestId('signin-body')).toContainText(/temporary|throwaway/i);
  });
});
