import { createHash } from 'node:crypto';
import type { FetchLike } from '@skillxone/github';

/** Test support shared by the worker tests: an in-memory GitHub. */

export const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
export const skillMd = (name: string, description = `Does ${name} things.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nInstructions.\n`;

export interface FakeRepo {
  id: number;
  owner: string;
  ownerId: number;
  name: string;
  stars: number;
  private?: boolean;
  archived?: boolean;
  files: Record<string, string>;
  modes?: Record<string, string>;
}

/** An in-memory stand-in for api.github.com and raw.githubusercontent.com. */
export class FakeGitHub {
  repos: FakeRepo[] = [];
  /** Old `owner/name` (lowercase) -> repository id, to emulate GitHub's rename redirects. */
  redirects = new Map<string, number>();
  apiCalls: string[] = [];
  rawCalls: string[] = [];
  rateLimited = false;
  truncateRecursive = false;

  head(repo: FakeRepo) {
    return sha1(JSON.stringify([repo.files, repo.modes ?? {}]));
  }
  private etag(repo: FakeRepo) {
    return `"${sha1(JSON.stringify([repo.owner, repo.ownerId, repo.name, repo.stars, repo.archived, this.head(repo)]))}"`;
  }
  private find(owner: string, name: string) {
    const key = `${owner}/${name}`.toLowerCase();
    return (
      this.repos.find((r) => `${r.owner}/${r.name}`.toLowerCase() === key) ??
      this.repos.find((r) => r.id === this.redirects.get(key))
    );
  }
  private treeItems(repo: FakeRepo, prefix: string, recursive: boolean) {
    const items = new Map<
      string,
      { path: string; mode: string; type: string; sha: string; size?: number }
    >();
    for (const [path, content] of Object.entries(repo.files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const segments = rest.split('/');
      if (recursive || segments.length === 1) {
        items.set(rest, {
          path: rest,
          mode: repo.modes?.[path] ?? '100644',
          type: 'blob',
          sha: sha1(`blob:${content}`),
          size: Buffer.byteLength(content),
        });
      }
      if (!recursive && segments.length > 1) {
        const dir = segments[0]!;
        items.set(dir, {
          path: dir,
          mode: '040000',
          type: 'tree',
          sha: sha1(`tree:${prefix}${dir}/`),
        });
      }
    }
    return [...items.values()];
  }

  fetch: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const { hostname, pathname, searchParams } = new URL(url);
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (hostname === 'raw.githubusercontent.com') {
      this.rawCalls.push(pathname);
      const [owner, name, commit, ...rest] = parts;
      const repo = this.find(owner!, name!);
      const content = repo && commit === this.head(repo) ? repo.files[rest.join('/')] : undefined;
      return content === undefined ? new Response('', { status: 404 }) : new Response(content);
    }

    this.apiCalls.push(pathname);
    if (this.rateLimited) {
      return new Response('{}', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
      });
    }
    const [, owner, name, ...rest] = parts;
    const repo = this.find(owner!, name!);
    if (!repo) return Response.json({ message: 'Not Found' }, { status: 404 });

    if (rest.length === 0) {
      if (headers['If-None-Match'] === this.etag(repo)) return new Response(null, { status: 304 });
      return Response.json(
        {
          id: repo.id,
          owner: { login: repo.owner, id: repo.ownerId, type: 'Organization' },
          name: repo.name,
          full_name: `${repo.owner}/${repo.name}`,
          description: 'A fake repository',
          homepage: null,
          default_branch: 'main',
          stargazers_count: repo.stars,
          forks_count: 3,
          open_issues_count: 1,
          archived: repo.archived ?? false,
          disabled: false,
          fork: false,
          private: repo.private ?? false,
          pushed_at: '2026-05-01T00:00:00Z',
          created_at: '2025-01-01T00:00:00Z',
          license: { spdx_id: 'MIT' },
        },
        { headers: { etag: this.etag(repo) } },
      );
    }
    if (rest[0] === 'commits') return new Response(this.head(repo));
    if (rest[0] === 'git' && rest[1] === 'trees') {
      const sha = rest[2]!;
      const recursive = searchParams.get('recursive') === '1';
      if (sha === this.head(repo)) {
        if (recursive && this.truncateRecursive) {
          return Response.json({
            sha,
            truncated: true,
            tree: this.treeItems(repo, '', true).slice(0, 1),
          });
        }
        return Response.json({ sha, truncated: false, tree: this.treeItems(repo, '', recursive) });
      }
      const dirs = new Set(
        Object.keys(repo.files)
          .filter((p) => p.includes('/'))
          .map((p) => `${p.split('/')[0]}/`),
      );
      const prefix = [...dirs].find((dir) => sha1(`tree:${dir}`) === sha);
      if (prefix)
        return Response.json({ sha, truncated: false, tree: this.treeItems(repo, prefix, true) });
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
}
