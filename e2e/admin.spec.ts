import { expect, test } from '@playwright/test';
import { createTestSession } from './sessions';
import type { Role } from './sessions';

/**
 * Access control over every admin page and admin endpoint, table-driven. Keep these lists in
 * step with apps/web/lib/admin.ts (pages) and apps/web/app/api/admin (endpoints).
 */

const PAGES: Array<[string, Role]> = [
  ['/admin', 'moderator'],
  ['/admin/submissions', 'moderator'],
  ['/admin/reports', 'moderator'],
  ['/admin/security', 'moderator'],
  ['/admin/skills', 'moderator'],
  ['/admin/repositories', 'moderator'],
  ['/admin/jobs', 'admin'],
  ['/admin/audit', 'admin'],
  ['/admin/settings', 'admin'],
];

const ENDPOINTS: Array<[string, Role, Record<string, string>]> = [
  ['/api/admin/submissions/does-not-exist', 'moderator', { status: 'rejected' }],
  ['/api/admin/reports/does-not-exist', 'moderator', { status: 'dismissed' }],
  ['/api/admin/findings/does-not-exist', 'moderator', { status: 'open' }],
  [
    '/api/admin/skills/does-not-exist',
    'moderator',
    { visibility: 'hidden', note: 'testing access' },
  ],
  ['/api/admin/jobs', 'admin', { action: 'run', type: 'rank' }],
  ['/api/admin/settings', 'admin', { submissions_open: 'true' }],
];

const sessions = {} as Record<Role, ReturnType<typeof createTestSession>>;
test.beforeAll(() => {
  for (const role of ['user', 'moderator', 'admin'] as const)
    sessions[role] = createTestSession(role);
});

test.describe('admin pages', () => {
  for (const [path, role] of PAGES) {
    test(`${path} needs ${role}`, async ({ request }) => {
      expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(401);
      expect(
        (await request.get(path, { headers: { cookie: sessions.user.cookie } })).status(),
      ).toBe(403);
      const moderator = await request.get(path, { headers: { cookie: sessions.moderator.cookie } });
      expect(moderator.status()).toBe(role === 'moderator' ? 200 : 403);
      expect(
        (await request.get(path, { headers: { cookie: sessions.admin.cookie } })).status(),
      ).toBe(200);
    });
  }

  test('a forged or expired cookie is refused', async ({ request }) => {
    expect(
      (
        await request.get('/admin', {
          headers: { cookie: 'sx_session=forged-token-value-that-is-long-enough' },
        })
      ).status(),
    ).toBe(401);
  });
});

test.describe('admin endpoints', () => {
  for (const [path, role, form] of ENDPOINTS) {
    test(`${path} needs ${role}, same origin and a CSRF token`, async ({ request, baseURL }) => {
      const post = (cookie: string | null, fields: Record<string, string>, origin = baseURL!) =>
        request.post(path, {
          form: fields,
          headers: { origin, ...(cookie ? { cookie } : {}) },
          maxRedirects: 0,
        });

      expect((await post(null, form)).status()).toBe(401);
      expect(
        (await post(sessions.user.cookie, { ...form, csrf: sessions.user.csrf })).status(),
      ).toBe(403);
      if (role === 'admin') {
        expect(
          (
            await post(sessions.moderator.cookie, { ...form, csrf: sessions.moderator.csrf })
          ).status(),
        ).toBe(403);
      }
      const noToken = await post(sessions.admin.cookie, form);
      expect(noToken.status()).toBe(403);
      expect((await noToken.json()).error.code).toBe('CSRF_FAILED');
      expect(
        (await post(sessions.admin.cookie, { ...form, csrf: sessions.moderator.csrf })).status(),
      ).toBe(403);
      expect(
        (
          await post(
            sessions.admin.cookie,
            { ...form, csrf: sessions.admin.csrf },
            'https://evil.example',
          )
        ).status(),
      ).toBe(403);

      // With everything in order the request reaches the action (a 404 for a made-up id).
      const allowed = await post(sessions.admin.cookie, {
        ...form,
        csrf: sessions.admin.csrf,
        back: '/admin',
      });
      expect([303, 404]).toContain(allowed.status());
    });
  }

  test('the back link cannot redirect off the admin area', async ({ request, baseURL }) => {
    const response = await request.post('/api/admin/settings', {
      form: { submissions_open: 'true', csrf: sessions.admin.csrf, back: '//evil.example/admin' },
      headers: { cookie: sessions.admin.cookie, origin: baseURL! },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(new URL(response.headers().location!).host).toBe(new URL(baseURL!).host);
  });
});

test.describe('public write endpoints', () => {
  test('need a CSRF token when a session cookie is sent', async ({ request }) => {
    const body = {
      repository: `octocat/csrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    const withCookie = await request.post('/api/v1/submissions', {
      data: body,
      headers: { cookie: sessions.user.cookie },
    });
    expect(withCookie.status()).toBe(403);
    const withToken = await request.post('/api/v1/submissions', {
      data: body,
      headers: { cookie: sessions.user.cookie, 'x-csrf-token': sessions.user.csrf },
    });
    expect(withToken.status()).toBe(201);
  });

  test('reject non-JSON, cross-site and non-GitHub submissions; return duplicates', async ({
    request,
  }) => {
    expect(
      (await request.post('/api/v1/submissions', { form: { repository: 'a/b' } })).status(),
    ).toBe(415);
    expect(
      (
        await request.post('/api/v1/submissions', {
          data: { repository: 'a/b' },
          headers: { origin: 'https://evil.example' },
        })
      ).status(),
    ).toBe(403);
    const bad = await request.post('/api/v1/submissions', {
      data: { repository: 'https://gitlab.com/a/b' },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_REQUEST');

    const repository = `octocat/dupe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const first = await request.post('/api/v1/submissions', { data: { repository } });
    expect(first.status()).toBe(201);
    const again = await request.post('/api/v1/submissions', {
      data: { repository: `https://github.com/${repository.toUpperCase()}` },
    });
    expect(again.status()).toBe(200);
    const [a, b] = [await first.json(), await again.json()];
    expect(b).toMatchObject({ duplicate: true, data: { id: a.data.id } });
  });

  test('reports validate the skill and the finding', async ({ request }) => {
    const list = await (await request.get('/api/v1/skills?q=remote-setup-helper')).json();
    const skillId = list.data[0].id;
    const security = await (await request.get(`/api/v1/skills/${skillId}/security`)).json();
    const findingId = security.data.report.findings[0].id;
    const report = await request.post('/api/v1/reports', {
      data: {
        type: 'false_positive',
        skillId,
        findingId,
        body: `E2E report ${Date.now()}: the installer is documented.`,
      },
    });
    expect([200, 201]).toContain(report.status());
    expect(
      (
        await request.post('/api/v1/reports', {
          data: { type: 'security_concern', skillId: 'nope', body: 'Not a real skill id.' },
        })
      ).status(),
    ).toBe(400);
  });
});

test.describe('admin accessibility', () => {
  for (const [path] of PAGES) {
    test(`${path} has no serious or critical axe violations and no sideways scroll`, async ({
      page,
      context,
      baseURL,
    }) => {
      const [name, value] = sessions.admin.cookie.split('=') as [string, string];
      await context.addCookies([{ name, value, url: baseURL! }]);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      const { default: AxeBuilder } = await import('@axe-core/playwright');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(blocking, blocking.join('\n')).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
