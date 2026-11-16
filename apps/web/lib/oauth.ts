import type { UserRole } from '@skillxone/database';

/**
 * GitHub OAuth web flow (sign-in only). The access token is used once to read the public
 * profile and then dropped: it is never stored, logged or returned. No scopes are requested.
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  adminIds: readonly number[];
  moderatorIds: readonly number[];
}

export interface GitHubProfile {
  githubId: number;
  login: string;
  avatarUrl: string | null;
}

export const CALLBACK_PATH = '/auth/github/callback';

export function authorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', new URL(CALLBACK_PATH, config.siteUrl).toString());
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export function roleFor(
  githubId: number,
  config: Pick<OAuthConfig, 'adminIds' | 'moderatorIds'>,
): UserRole {
  if (config.adminIds.includes(githubId)) return 'admin';
  if (config.moderatorIds.includes(githubId)) return 'moderator';
  return 'user';
}

export class OAuthError extends Error {}

/** Exchanges the code for a token, reads the profile, and forgets the token. */
export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubProfile> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(code)) throw new OAuthError('Malformed authorization code.');
  const tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: new URL(CALLBACK_PATH, config.siteUrl).toString(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as { access_token?: unknown };
  if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
    throw new OAuthError('GitHub did not issue an access token.');
  }
  const userResponse = await fetchImpl('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': 'skillxone',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const user = (await userResponse.json().catch(() => ({}))) as {
    id?: unknown;
    login?: unknown;
    avatar_url?: unknown;
  };
  if (
    !userResponse.ok ||
    typeof user.id !== 'number' ||
    !Number.isSafeInteger(user.id) ||
    typeof user.login !== 'string' ||
    !/^[A-Za-z0-9-]{1,39}$/.test(user.login)
  ) {
    throw new OAuthError('GitHub did not return a usable profile.');
  }
  const avatar =
    typeof user.avatar_url === 'string' &&
    user.avatar_url.startsWith('https://avatars.githubusercontent.com/')
      ? user.avatar_url
      : null;
  return { githubId: user.id, login: user.login, avatarUrl: avatar };
}
