import { describe, expect, it } from 'vitest';
import { parseReportBody, parseSubmissionBody, readJsonBody } from './community-api';
import { authorizeUrl, exchangeCode, OAuthError, roleFor } from './oauth';
import { csrfToken, originAllowed, verifyCsrf } from './security';

describe('CSRF tokens', () => {
  it('verify only the token derived from the session secret', () => {
    const token = csrfToken('secret-a');
    expect(verifyCsrf('secret-a', token)).toBe(true);
    expect(verifyCsrf('secret-b', token)).toBe(false);
    expect(verifyCsrf('secret-a', null)).toBe(false);
    expect(verifyCsrf('secret-a', '')).toBe(false);
    expect(verifyCsrf('secret-a', `${token}x`)).toBe(false);
    expect(verifyCsrf('secret-a', 'x'.repeat(500))).toBe(false);
  });
});

describe('origin check', () => {
  const site = 'https://skills.example.org';
  const request = (origin?: string) =>
    new Request('https://skills.example.org/api/v1/reports', {
      method: 'POST',
      headers: origin ? { origin } : {},
    });
  it('accepts this site and requests without an Origin header', () => {
    expect(originAllowed(request('https://skills.example.org'), site)).toBe(true);
    expect(originAllowed(request(), site)).toBe(true);
  });
  it('refuses other sites, opaque origins and junk', () => {
    expect(originAllowed(request('https://evil.example'), site)).toBe(false);
    expect(originAllowed(request('https://skills.example.org.evil.example'), site)).toBe(false);
    expect(originAllowed(request('null'), site)).toBe(false);
    expect(originAllowed(request('not a url'), site)).toBe(false);
  });
});

describe('submission validation', () => {
  it('accepts owner/repo and GitHub URLs', () => {
    expect(parseSubmissionBody({ repository: 'octo/skills' })).toEqual({
      ok: true,
      value: { owner: 'octo', repo: 'skills', note: null },
    });
    expect(
      parseSubmissionBody({ repository: 'https://github.com/octo/skills', note: ' hi ' }),
    ).toMatchObject({ ok: true, value: { note: 'hi' } });
  });
  it.each([
    [{}],
    [{ repository: 'https://gitlab.com/octo/skills' }],
    [{ repository: 'http://github.com/octo/skills' }],
    [{ repository: 'https://user:pass@github.com/octo/skills' }],
    [{ repository: 'octo' }],
    [{ repository: 'octo/skills/extra' }],
    [{ repository: '../../etc/passwd' }],
    [{ repository: 'octo/sk ills' }],
    [{ repository: 'javascript:alert(1)' }],
    [{ repository: 'octo/skills', note: 'x'.repeat(1001) }],
    [{ repository: 'octo/skills', note: 'bell\u0007' }],
    [{ repository: 42 }],
    [[]],
    [null],
  ])('rejects %j', (body) => {
    expect(parseSubmissionBody(body).ok).toBe(false);
  });
});

describe('report validation', () => {
  const valid = { type: 'security_concern', skillId: 'abc', body: 'This skill uploads files.' };
  it('accepts a complete report', () => {
    expect(parseReportBody(valid)).toMatchObject({
      ok: true,
      value: { type: 'security_concern', skillId: 'abc', findingId: null, contact: null },
    });
    expect(parseReportBody({ type: 'other', body: 'General feedback here.' }).ok).toBe(true);
  });
  it.each([
    [{ ...valid, type: 'spam' }],
    [{ ...valid, skillId: undefined }],
    [{ ...valid, skillId: 'a b' }],
    [{ ...valid, body: 'short' }],
    [{ ...valid, body: 'x'.repeat(5001) }],
    [{ ...valid, type: 'false_positive' }],
    [{ ...valid, contact: 'x'.repeat(201) }],
    [{ ...valid, findingId: { $ne: null } }],
  ])('rejects %j', (body) => {
    expect(parseReportBody(body).ok).toBe(false);
  });
});

describe('JSON bodies', () => {
  const post = (body: string, type = 'application/json') =>
    new Request('http://x/api', { method: 'POST', headers: { 'content-type': type }, body });
  it('need a JSON content type, valid JSON and a small size', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ ok: true, data: { a: 1 } });
    const form = await readJsonBody(post('a=1', 'application/x-www-form-urlencoded'));
    expect(!form.ok && form.response.status).toBe(415);
    const bad = await readJsonBody(post('{oops'));
    expect(!bad.ok && bad.response.status).toBe(400);
    const big = await readJsonBody(post(JSON.stringify({ body: 'x'.repeat(9000) })));
    expect(!big.ok && big.response.status).toBe(413);
  });
});

describe('GitHub OAuth', () => {
  const config = {
    clientId: 'cid',
    clientSecret: 'csecret',
    siteUrl: 'https://skills.example.org',
    adminIds: [1],
    moderatorIds: [2],
  };

  it('builds the authorize URL without scopes', () => {
    const url = new URL(authorizeUrl(config, 'state123'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://skills.example.org/auth/github/callback',
    );
    expect(url.searchParams.get('state')).toBe('state123');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('maps allowlisted ids to roles', () => {
    expect(roleFor(1, config)).toBe('admin');
    expect(roleFor(2, config)).toBe('moderator');
    expect(roleFor(3, config)).toBe('user');
  });

  it('reads the profile and never returns the token', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });
      if (url.includes('access_token')) return Response.json({ access_token: 'gho_secret_token' });
      return Response.json({
        id: 99,
        login: 'octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/99',
      });
    }) as typeof fetch;
    const profile = await exchangeCode(config, 'code123', fake);
    expect(profile).toEqual({
      githubId: 99,
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/99',
    });
    expect(JSON.stringify(profile)).not.toContain('gho_secret_token');
    expect(calls[1]).toEqual({
      url: 'https://api.github.com/user',
      auth: 'Bearer gho_secret_token',
    });
  });

  it('fails closed on bad codes, missing tokens and odd profiles', async () => {
    const respond = (token: unknown, user: unknown) =>
      (async (url: string) =>
        Response.json(url.includes('access_token') ? token : user)) as typeof fetch;
    await expect(exchangeCode(config, 'bad code!', respond({}, {}))).rejects.toBeInstanceOf(
      OAuthError,
    );
    await expect(
      exchangeCode(config, 'c', respond({ error: 'bad_verification_code' }, {})),
    ).rejects.toBeInstanceOf(OAuthError);
    await expect(
      exchangeCode(config, 'c', respond({ access_token: 't' }, { id: '99', login: 'x' })),
    ).rejects.toBeInstanceOf(OAuthError);
    await expect(
      exchangeCode(config, 'c', respond({ access_token: 't' }, { id: 99, login: '<script>' })),
    ).rejects.toBeInstanceOf(OAuthError);
    const odd = await exchangeCode(
      config,
      'c',
      respond(
        { access_token: 't' },
        { id: 5, login: 'ok', avatar_url: 'https://evil.example/a.png' },
      ),
    );
    expect(odd.avatarUrl).toBeNull();
  });
});
