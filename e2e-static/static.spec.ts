import AxeBuilder from '@axe-core/playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const out = join(import.meta.dirname, '..', 'out-static');

test('the catalog page lists every skill and links to detail pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent skills catalog' })).toBeVisible();
  const links = page.locator('main .row a[href*="skills/"]');
  await expect(links).toHaveCount(25);
  await links.filter({ hasText: 'remote-setup-helper' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('remote-setup-helper');
  await expect(page.getByRole('alert')).toContainText('security findings');
  await expect(page.getByText('CMD-REMOTE-PIPE-SHELL')).toBeVisible();
});

test('client-side search returns results', async ({ page }) => {
  await page.goto('/search/');
  const input = page.getByLabel('Search skills by name, description or repository');
  await expect(input).toBeEnabled();
  await input.fill('docker');
  await expect(page.getByRole('status')).toContainText(/\d+ results?\./);
  const first = page.locator('#results a').first();
  await expect(first).toContainText(/docker/i);
  await first.click();
  await expect(page.locator('h1')).toContainText(/docker/i);
  await page.goto('/search/?q=zzzz-no-such-skill');
  await expect(page.getByRole('status')).toHaveText('No skills match.');
});

test('detail pages show install commands pinned to verified commits', async ({ page }) => {
  await page.goto('/skills/example-fixture/ops-skills/dockerfile-reviewer/');
  const command = page.locator('pre code').first();
  await expect(command).toHaveText(
    /^npx skills add example-fixture\/ops-skills@[0-9a-f]{40} --skill dockerfile-reviewer -a /,
  );
  await expect(page.getByText('Pinned to the verified commit.').first()).toBeVisible();
});

test('read-only JSON mirrors the API, and nothing server-only is exported', async ({ request }) => {
  const list = await (await request.get('/api/v1/skills.json')).json();
  expect(list.data).toHaveLength(25);
  const detail = await (await request.get(`/api/v1/skills/${list.data[0].id}.json`)).json();
  expect(detail.data.id).toBe(list.data[0].id);
  const security = await (
    await request.get(`/api/v1/skills/${list.data[0].id}/security.json`)
  ).json();
  expect(security.data.verification).toBeTruthy();

  const all = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? all(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const files = all(out).map((file) => file.slice(out.length));
  expect(files.some((file) => file.startsWith('/admin'))).toBe(false);
  expect(
    files.some((file) => /^\/(api\/v1\/(submissions|reports)|api\/admin|auth)\b/.test(file)),
  ).toBe(false);
  expect(existsSync(join(out, 'search', 'index.json'))).toBe(true);
  // Rendered SKILL.md content never carries scripts, frames or images.
  for (const file of files.filter((f) => f.startsWith('/skills/'))) {
    const html = readFileSync(join(out, file), 'utf8');
    expect(html, file).not.toMatch(/<(script|iframe|img|object|embed)\b/i);
  }
});

for (const path of [
  '/',
  '/search/',
  '/categories/',
  '/categories/devops/',
  '/skills/example-fixture/ops-skills/remote-setup-helper/',
]) {
  test(`${path} has no serious accessibility violations or sideways scroll`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(blocking, blocking.join('\n')).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
