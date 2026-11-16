import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** One URL per page template. */
const PAGES = [
  ['home', '/'],
  ['explore list', '/explore?q=review'],
  ['explore cards', '/explore?view=cards'],
  ['explore empty', '/explore?q=zzzz-no-such-skill'],
  ['categories', '/categories'],
  ['category', '/categories/devops'],
  ['trending', '/trending'],
  ['verified', '/verified'],
  ['collections', '/collections'],
  ['collection', '/collections/getting-started'],
  ['skill overview', '/skills/example-fixture/starter-skills/commit-message-writer'],
  [
    'skill files',
    '/skills/example-fixture/ops-skills/remote-setup-helper?tab=files&file=scripts%2Fsetup.sh',
  ],
  [
    'skill security (flagged)',
    '/skills/example-fixture/ops-skills/remote-setup-helper?tab=security',
  ],
  [
    'skill security (unverified)',
    '/skills/example-fixture/starter-skills/changelog-updater?tab=security',
  ],
  ['skill versions', '/skills/example-fixture/starter-skills/commit-message-writer?tab=versions'],
  ['submit', '/submit'],
  ['report', '/report?skill=example-fixture%2Fops-skills%2Fremote-setup-helper'],
  ['docs', '/docs'],
  ['api docs', '/docs/api'],
  ['contribute', '/contribute'],
  ['about', '/about'],
  ['not found', '/this-page-does-not-exist'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem('skillxone-theme', value);
        } catch {
          /* storage unavailable */
        }
      }, theme);
    });

    for (const [name, path] of PAGES) {
      test(`${name} has no serious or critical axe violations and no sideways scroll`, async ({
        page,
      }) => {
        await page.goto(path);
        if (theme === 'dark') {
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        }

        // Check the settled page: wait for one-shot entrance animations (they fade text in)
        // to finish. Infinite decorative loops and scroll-linked animations are left running.
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => undefined)),
          ),
        );

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map(
            (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          );
        expect(blocking, blocking.join('\n')).toEqual([]);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
        // A mobile browser widens its layout viewport when content overflows, which hides
        // the overflow from the check above; the layout width must still equal the device's.
        const layoutWidth = await page.evaluate(() => window.innerWidth);
        expect(layoutWidth, 'content is wider than the screen').toBe(page.viewportSize()?.width);
      });
    }
  });
}

test('keyboard users get a skip link and visible focus', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hardware keyboard navigation is checked on desktop');
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('pages are served with a nonce-based Content Security Policy and run without violations', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  for (const path of [
    '/',
    '/explore?q=review',
    '/skills/example-fixture/ops-skills/dockerfile-reviewer',
    '/submit',
  ]) {
    const response = await page.goto(path);
    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-eval');
  }
  // The theme script and the interactive install panel still work.
  await page.goto('/skills/example-fixture/ops-skills/dockerfile-reviewer');
  await page.getByText('Codex', { exact: true }).first().click();
  await expect(page.locator('#install-command')).toContainText('-a codex');
  expect(violations).toEqual([]);
});

test('the main journey works with the keyboard alone', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard navigation is a desktop concern');
  await page.goto('/skills/example-fixture/ops-skills/dockerfile-reviewer');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);

  // The agent choice is a radio group: focus it and change it with the arrow keys.
  const claude = page.getByRole('radio', { name: 'Claude Code' });
  await claude.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Codex' })).toBeChecked();
  await expect(page.locator('#install-command')).toContainText('-a codex');

  // The copy button is reachable and has an accessible name.
  const copy = page.getByRole('button', { name: /copy/i }).first();
  await copy.focus();
  await expect(copy).toBeFocused();
});
