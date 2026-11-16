import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

describe('parseEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBe('file:./data/skillxone.db');
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.ALLOW_DEV_FIXTURES).toBe(false);
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('treats an empty token as unset', () => {
    expect(parseEnv({ GITHUB_TOKEN: '' }).GITHUB_TOKEN).toBeUndefined();
  });

  it('rejects an unsupported database URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/x' })).toThrow(EnvError);
  });

  it('never echoes values in error messages', () => {
    const secret = 'mysql://user:hunter2@host/db';
    try {
      parseEnv({ DATABASE_URL: secret, WORKER_CONCURRENCY: '0' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('WORKER_CONCURRENCY');
      expect(message).not.toContain('hunter2');
    }
  });
});
