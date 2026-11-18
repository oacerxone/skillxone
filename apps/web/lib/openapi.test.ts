import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi';

const appDir = join(import.meta.dirname, '..', 'app');

/** Every API route file, as an OpenAPI path with the HTTP methods it exports. */
function implementedRoutes(): Map<string, Set<string>> {
  const routes = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'route.ts') {
        const path = `/${relative(appDir, dir).split(sep).join('/')}`.replace(/\[(\w+)\]/g, '{$1}');
        const source = readFileSync(full, 'utf8');
        const methods = new Set(
          [
            ...source.matchAll(
              /export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g,
            ),
          ].map((m) => m[1]!.toLowerCase()),
        );
        routes.set(path, methods);
      }
    }
  };
  walk(join(appDir, 'api'));
  return routes;
}

describe('OpenAPI document', () => {
  it('is valid OpenAPI 3.1', async () => {
    const result = await new Validator().validate(
      structuredClone(openApiDocument) as unknown as Parameters<Validator['validate']>[0],
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('describes exactly the public routes that exist, with their methods', () => {
    const implemented = implementedRoutes();
    // Admin routes and the payment provider's webhook are not part of the public API.
    const publicRoutes = [...implemented].filter(
      ([path]) => !path.startsWith('/api/admin/') && !path.startsWith('/api/billing/'),
    );
    const documented = Object.entries(openApiDocument.paths).map(
      ([path, item]) => [path, new Set(Object.keys(item))] as const,
    );
    expect(documented.map(([path]) => path).sort()).toEqual(
      publicRoutes.map(([path]) => path).sort(),
    );
    for (const [path, methods] of documented)
      expect([...methods].sort(), path).toEqual([...implemented.get(path)!].sort());
  });

  it('keeps admin routes out of the public document', () => {
    const admin = [...implementedRoutes().keys()].filter((path) => path.startsWith('/api/admin/'));
    expect(admin.length).toBeGreaterThan(0);
    for (const path of admin) expect(Object.keys(openApiDocument.paths)).not.toContain(path);
  });
});
