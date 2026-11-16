import { expect, test } from '@playwright/test';

test.describe('Explore filters live in the URL', () => {
  test('selecting filters updates the URL and survives a reload', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByText('Showing 1–25 of 25 skills')).toBeVisible();

    await page.getByLabel('Category').selectOption('devops');
    await expect(page).toHaveURL(/category=devops/);
    await page.getByLabel('Verification').selectOption('verified');
    await expect(page).toHaveURL(/verification=verified/);
    await page.getByLabel('Agent').selectOption('claude-code');
    await expect(page).toHaveURL(/agent=claude-code/);
    await page.getByLabel('Sort by').selectOption('name');
    await expect(page).toHaveURL(/sort=name/);

    await expect(page.getByText('Showing 1–1 of 1 skill')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'dockerfile-reviewer', exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Category')).toHaveValue('devops');
    await expect(page.getByLabel('Verification')).toHaveValue('verified');
    await expect(page.getByLabel('Agent')).toHaveValue('claude-code');
    await expect(page.getByLabel('Sort by')).toHaveValue('name');
    await expect(page.getByText('Showing 1–1 of 1 skill')).toBeVisible();
  });

  test('typing searches after a pause, highlights matches and can be cleared', async ({ page }) => {
    await page.goto('/explore');
    const search = page.getByRole('combobox', { name: /^Search/ });
    await search.fill('terraform');
    await expect(page).toHaveURL(/\/explore\?q=terraform$/);
    await expect(page.locator('mark').first()).toHaveText(/terraform/i);
    await expect(page.getByText('Showing 1–1 of 1 skill')).toBeVisible();

    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(search).toHaveValue('');
  });

  test('an empty result explains itself', async ({ page }) => {
    await page.goto('/explore?q=zzzz-no-such-skill');
    await expect(page.getByText('No skills match these filters')).toBeVisible();
  });

  test('hostile query strings are ignored or shown as inert text', async ({ page }) => {
    const payload = '<img src=x onerror=alert(1)>';
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(
      `/explore?q=${encodeURIComponent(payload)}&category=${encodeURIComponent("x' OR 1=1")}&sort=bogus&page=-5`,
    );
    await expect(page.getByText('No skills match these filters')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Search/ })).toHaveValue(payload);
    await expect(page.locator('main img')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('the card layout is kept in the URL', async ({ page }) => {
    await page.goto('/explore');
    await page
      .getByRole('navigation', { name: 'Layout' })
      .getByRole('link', { name: 'Cards' })
      .click();
    await expect(page).toHaveURL(/view=cards/);
    await expect(page.locator('main table')).toHaveCount(0);
    await page.getByLabel('Category').selectOption('data');
    await expect(page).toHaveURL(/category=data/);
    await expect(page).toHaveURL(/view=cards/);
  });

  test('"/" focuses the search field', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut is a desktop affordance');
    await page.goto('/explore');
    await page.locator('body').press('/');
    await expect(page.getByRole('combobox', { name: /^Search/ })).toBeFocused();
  });
});
