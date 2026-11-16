import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Internal packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@skillxone/shared',
    '@skillxone/database',
    '@skillxone/ui',
    '@skillxone/installer',
  ],
  // Native and server-only drivers must not be bundled.
  serverExternalPackages: ['better-sqlite3', 'pg'],
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
