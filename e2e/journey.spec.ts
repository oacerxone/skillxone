import { expect, test } from '@playwright/test';

/**
 * The core journey: discover, evaluate, verify, install.
 * Runs on the desktop and the 375 px mobile project.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('home -> search -> skill -> copy the install command', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find agent skills');
  await expect(page.getByRole('status').filter({ hasText: 'Development data' })).toBeVisible();

  await page.getByRole('main').getByRole('searchbox', { name: 'Search skills' }).fill('dockerfile');
  await page.getByRole('main').getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/explore\?q=dockerfile$/);
  await expect(page.getByText('Showing 1–1 of 1 skill')).toBeVisible();

  await page.getByRole('link', { name: 'dockerfile-reviewer', exact: true }).click();
  await expect(page).toHaveURL(/\/skills\/example-fixture\/ops-skills\/dockerfile-reviewer$/);
  await expect(page.getByRole('heading', { level: 1, name: 'dockerfile-reviewer' })).toBeVisible();

  const command = page.locator('#install-command');
  // A verified skill is pinned to the assessed commit by default.
  await expect(command).toHaveText(
    /^npx skills add example-fixture\/ops-skills@[0-9a-f]{40} --skill dockerfile-reviewer -a claude-code$/,
  );

  const install = page.getByRole('region', { name: 'Install' });
  await install.getByRole('button', { name: 'Copy' }).first().click();
  await expect(install.getByRole('button', { name: 'Copied' })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(await command.textContent());
});

test('the install panel reacts to agent, scope and pinning', async ({ page }) => {
  await page.goto('/skills/example-fixture/ops-skills/dockerfile-reviewer');
  const command = page.locator('#install-command');

  await page.getByText('Codex', { exact: true }).first().click();
  await expect(command).toContainText('-a codex');
  await expect(page.getByText('.agents/skills/dockerfile-reviewer/')).toBeVisible();

  await page.getByText('All projects', { exact: true }).click();
  await expect(command).toHaveText(/ -a codex -g$/);
  await expect(page.getByText('~/.agents/skills/dockerfile-reviewer/')).toBeVisible();

  await page.getByRole('checkbox', { name: /Pin to the verified commit/ }).uncheck();
  await expect(command).toHaveText(
    'npx skills add example-fixture/ops-skills --skill dockerfile-reviewer -a codex -g',
  );
});

test('a flagged skill shows its findings and a warning above the command', async ({ page }) => {
  await page.goto('/skills/example-fixture/ops-skills/remote-setup-helper');
  await expect(
    page.getByRole('alert').filter({ hasText: 'This version has security findings' }),
  ).toBeVisible();
  // Flagged versions are never pinned as "verified".
  await expect(page.locator('#install-command')).not.toContainText('@');
  await expect(page.getByRole('checkbox', { name: /Pin to the verified commit/ })).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Skill sections' })
    .getByRole('link', { name: 'Security' })
    .click();
  await expect(page).toHaveURL(/tab=security$/);
  await expect(page.getByText('CMD-REMOTE-PIPE-SHELL')).toBeVisible();
  await expect(page.getByText('Checks skipped')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Report as false positive' }).first()).toBeVisible();
});

test('an unverified skill explains that it has not been assessed', async ({ page }) => {
  await page.goto('/skills/example-fixture/starter-skills/changelog-updater?tab=security');
  await expect(page.getByRole('heading', { name: 'No assessment for this version' })).toBeVisible();
  await expect(page.getByText('This version has not been assessed.')).toBeVisible();
});

test('skill files can be opened and are shown as inert text', async ({ page }) => {
  await page.goto('/skills/example-fixture/ops-skills/remote-setup-helper?tab=files');
  await page.getByRole('link', { name: 'scripts/setup.sh' }).click();
  await expect(page).toHaveURL(/file=scripts%2Fsetup\.sh$/);
  await expect(page.locator('pre').filter({ hasText: 'curl -fsSL' })).toBeVisible();
});

test('rendered SKILL.md contains no images, scripts or frames', async ({ page }) => {
  await page.goto('/skills/example-fixture/starter-skills/commit-message-writer');
  const prose = page.locator('.prose-skill');
  await expect(prose.getByRole('heading', { name: 'Commit Message Writer' })).toBeVisible();
  await expect(prose.locator('img, script, iframe, style')).toHaveCount(0);
  // The frontmatter block is not rendered as body text.
  await expect(prose).not.toContainText('fixture: "true"');
  // Relative links resolve inside the source repository at the indexed commit.
  await expect(prose.getByRole('link', { name: 'references/guide.md' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/example-fixture\/starter-skills\/blob\/[0-9a-f]{40}\/skills\/commit-message-writer\/references\/guide\.md$/,
  );
});

test('unknown pages and skills return 404', async ({ page }) => {
  for (const path of ['/nope', '/skills/a/b/c', '/categories/does-not-exist', '/collections/x']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});

test('forms that are not wired up say so instead of pretending to send', async ({ page }) => {
  await page.goto('/submit');
  await page.getByLabel('GitHub repository').fill('octocat/hello-world');
  await page.getByRole('button', { name: 'Submit repository' }).click();
  await expect(
    page.getByText('Not sent: submissions are not enabled in this build.'),
  ).toBeVisible();
});

test('navigation reaches every primary section', async ({ page, isMobile }) => {
  await page.goto('/');
  for (const [label, heading] of [
    ['Explore', 'Explore skills'],
    ['Categories', 'Categories'],
    ['Trending', 'Recently active skills'],
    ['Verified', 'Verified skills'],
    ['Collections', 'Collections'],
    ['Submit Skill', 'Submit a skill repository'],
  ] as const) {
    if (isMobile) await page.getByText('Menu', { exact: true }).click();
    const nav = page.getByRole('navigation', { name: isMobile ? 'Menu' : 'Primary' });
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});
