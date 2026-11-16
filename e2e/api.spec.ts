import { expect, test } from '@playwright/test';

/** The public read API, exercised over HTTP against the production build. */
test.describe('REST API v1', () => {
  test('lists skills with pagination metadata and rate-limit headers', async ({ request }) => {
    const response = await request.get('/api/v1/skills?per_page=5');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-ratelimit-limit']).toBeTruthy();
    expect(response.headers()['cache-control']).toContain('public');
    const body = await response.json();
    expect(body.pagination).toEqual({ page: 1, perPage: 5, total: 25, pages: 5 });
    expect(body.data).toHaveLength(5);
    expect(Object.keys(body.data[0]).sort()).toEqual(
      [
        'agents',
        'description',
        'firstIndexedAt',
        'id',
        'license',
        'lifecycle',
        'name',
        'quality',
        'repository',
        'slug',
        'updatedAt',
        'url',
        'verification',
      ].sort(),
    );
  });

  test('filters and sorts', async ({ request }) => {
    const body = await (await request.get('/api/v1/skills?verification=flagged&sort=name')).json();
    expect(body.data.map((s: { name: string }) => s.name)).toEqual([
      'env-collector',
      'remote-setup-helper',
    ]);
    const codex = await (
      await request.get('/api/v1/skills?agent=codex&category=devops&per_page=100')
    ).json();
    expect(codex.data.every((s: { agents: string[] }) => s.agents.includes('codex'))).toBe(true);
  });

  test('ranks a flagged skill below others by default', async ({ request }) => {
    const body = await (await request.get('/api/v1/skills?per_page=100')).json();
    const names: string[] = body.data.map((s: { name: string }) => s.name);
    const qualities: number[] = body.data.map((s: { quality: number }) => s.quality);
    expect(qualities.every((q) => typeof q === 'number' && q >= 0 && q <= 1)).toBe(true);
    expect([...qualities].sort((a, b) => b - a)).toEqual(qualities);
    expect(names.indexOf('env-collector')).toBeGreaterThan(names.indexOf('dockerfile-reviewer'));
  });

  test('searches, and requires a query', async ({ request }) => {
    const found = await (await request.get('/api/v1/search?q=dockerf')).json();
    expect(found.query).toBe('dockerf');
    expect(found.data[0].name).toBe('dockerfile-reviewer');

    const missing = await request.get('/api/v1/search');
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: '"q" is required.' },
    });
  });

  test('suggests names for a partial query', async ({ request }) => {
    const body = await (await request.get('/api/v1/suggest?q=read')).json();
    expect(body.data[0]).toMatchObject({ name: 'readme-writer' });
    expect((await (await request.get('/api/v1/suggest?q=r')).json()).data).toEqual([]);
  });

  test('builds install instructions without running anything', async ({ request }) => {
    const list = await (await request.get('/api/v1/skills?q=dockerfile-reviewer')).json();
    const id = list.data[0].id;
    const body = await (
      await request.get(`/api/v1/skills/${id}/install?agent=codex&scope=global`)
    ).json();
    expect(body.data.verification).toBe('VERIFIED');
    expect(body.data.plan).toMatchObject({
      agent: { id: 'codex', label: 'Codex' },
      pinned: true,
      targetDir: '~/.agents/skills/dockerfile-reviewer/',
    });
    expect(body.data.plan.install).toMatch(
      /^npx skills add example-fixture\/ops-skills@[0-9a-f]{40} --skill dockerfile-reviewer -a codex -g$/,
    );
    const manual = await (
      await request.get(`/api/v1/skills/${id}/install?method=manual&pin=false`)
    ).json();
    expect(manual.data.plan).toMatchObject({ install: null, pinned: false });
    expect(manual.data.plan.steps.length).toBeGreaterThan(1);

    for (const query of ['agent=cursor', 'scope=system', 'method=curl', 'pin=maybe', 'shell=cmd']) {
      const response = await request.get(`/api/v1/skills/${id}/install?${query}`);
      expect(response.status(), query).toBe(400);
    }
  });

  test('returns one skill, its versions and its security report by id', async ({ request }) => {
    const list = await (await request.get('/api/v1/skills?q=remote-setup-helper')).json();
    const id = list.data[0].id;

    const skill = await (await request.get(`/api/v1/skills/${id}`)).json();
    expect(skill.data).toMatchObject({ id, name: 'remote-setup-helper', verification: 'FLAGGED' });
    expect(skill.data.files.map((f: { path: string }) => f.path)).toContain('scripts/setup.sh');
    expect(skill.data.ranking.adjustments[0]).toContain('flagged');

    const versions = await (await request.get(`/api/v1/skills/${id}/versions`)).json();
    expect(versions.data[0]).toMatchObject({ current: true });
    expect(versions.data[0].commitSha).toMatch(/^[0-9a-f]{40}$/);

    const security = await (await request.get(`/api/v1/skills/${id}/security`)).json();
    expect(security.data.verification).toBe('FLAGGED');
    expect(security.data.report.findings).toHaveLength(2);
    expect(security.data.report.checksSkipped[0].scanner).toBe('dependencies');
    // Internal fields never reach the public report.
    const text = JSON.stringify(security.data);
    for (const internal of ['"log"', 'reviewed_by', 'review_note', 'fingerprint']) {
      expect(text).not.toContain(internal);
    }

    const repository = await (
      await request.get(`/api/v1/repositories/${skill.data.repository.id}`)
    ).json();
    expect(repository.data).toMatchObject({
      fullName: 'example-fixture/ops-skills',
      skillCount: 4,
    });
    expect(JSON.stringify(repository.data)).not.toContain('etag');
  });

  test('lists categories', async ({ request }) => {
    const body = await (await request.get('/api/v1/categories')).json();
    expect(body.data.find((c: { slug: string }) => c.slug === 'devops')).toMatchObject({
      skillCount: 4,
    });
  });

  test('trending states its basis honestly when history is short', async ({ request }) => {
    const body = await (await request.get('/api/v1/trending')).json();
    expect(body.basis).toBe('recent_activity');
    expect(body.historyDays).toBeLessThan(body.requiredHistoryDays);
  });

  test('uses one error shape for unknown ids and bad paging', async ({ request }) => {
    for (const path of [
      '/api/v1/skills/does-not-exist',
      '/api/v1/skills/does-not-exist/security',
      '/api/v1/repositories/nope',
      '/api/v1/skills/..%2F..%2Fetc',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect((await response.json()).error.code).toBe('NOT_FOUND');
    }
    for (const query of ['page=0', 'page=-1', 'page=abc', 'per_page=1000', 'per_page=1.5']) {
      const response = await request.get(`/api/v1/skills?${query}`);
      expect(response.status(), query).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_REQUEST');
    }
  });

  test('treats hostile filter values as absent rather than failing', async ({ request }) => {
    const response = await request.get(
      `/api/v1/skills?category=${encodeURIComponent("x' OR '1'='1")}&sort=${encodeURIComponent('name; drop table skills')}&q=${encodeURIComponent('"*) OR NEAR(')}`,
    );
    expect(response.status()).toBe(200);
    expect((await (await request.get('/api/v1/skills')).json()).pagination.total).toBe(25);
  });

  test('only GET is offered on read endpoints', async ({ request }) => {
    expect((await request.post('/api/v1/skills', { data: {} })).status()).toBe(405);
    expect((await request.delete('/api/v1/categories')).status()).toBe(405);
  });
});

test('search suggestions appear while typing in Explore', async ({ page }) => {
  await page.goto('/explore');
  await page.getByRole('combobox', { name: /^Search/ }).fill('read');
  await expect(page.locator('#explore-suggestions option[value="readme-writer"]')).toHaveCount(1);
});

test('a skill page explains its ranking', async ({ page }) => {
  await page.goto('/skills/example-fixture/ops-skills/remote-setup-helper');
  const panel = page.getByRole('region', { name: 'Why it ranks where it does' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('flagged');
});
