/**
 * OpenAPI 3.1 description of the public API. Served at /api/v1/openapi.json. A test checks it
 * against the JSON Schema for OpenAPI 3.1 and against the route files that actually exist.
 * Admin routes (/api/admin/*) are form endpoints for the dashboard and are not part of it.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const error = (description: string) => json(ref('Error'), description);
const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,120}$' },
};
const query = (name: string, description: string, schema: object = { type: 'string' }) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});
const paging = [
  query('page', 'Page number, from 1.', { type: 'integer', minimum: 1, maximum: 100000 }),
  query('per_page', 'Items per page.', { type: 'integer', minimum: 1, maximum: 100, default: 30 }),
];
const filters = [
  query('agent', 'Agent id, for example claude-code or codex.'),
  query('verification', 'verified, unverified or flagged.', {
    type: 'string',
    enum: ['verified', 'unverified', 'flagged'],
  }),
  query('category', 'Category slug.'),
  query('sort', 'Sort order.', {
    type: 'string',
    enum: [
      'recommended',
      'relevance',
      'popular',
      'trending',
      'rising',
      'maintained',
      'updated',
      'newest',
      'name',
    ],
  }),
];
const common = {
  '429': error('Rate limited. See Retry-After.'),
  '500': error('Internal error. No details are exposed.'),
};
const writeErrors = {
  '400': error('Invalid input.'),
  '401': error('A session cookie was sent but is no longer valid.'),
  '403': error('Cross-site request, or a session cookie without a valid X-CSRF-Token.'),
  '413': error('Body larger than 8 KiB.'),
  '415': error('Body is not application/json.'),
  ...common,
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'skillxone API',
    version: '1.0.0',
    description:
      'Read the catalog, security reports and install instructions; suggest repositories and report problems. ' +
      'No authentication is needed. Reads are rate limited per client; writes are limited to 10 an hour. ' +
      'The server never runs install commands; it only returns text.',
    license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Liveness and database check',
        operationId: 'health',
        responses: {
          '200': json(
            { type: 'object', properties: { status: { const: 'ok' }, database: { const: 'ok' } } },
            'Healthy.',
          ),
          '503': json(
            { type: 'object', properties: { status: { const: 'error' } } },
            'Database unavailable.',
          ),
        },
      },
    },
    '/api/v1/openapi.json': {
      get: {
        summary: 'This document',
        operationId: 'openapi',
        responses: { '200': json({ type: 'object' }, 'OpenAPI 3.1 document.') },
      },
    },
    '/api/v1/skills': {
      get: {
        summary: 'List and filter skills',
        operationId: 'listSkills',
        parameters: [query('q', 'Optional search text.'), ...filters, ...paging],
        responses: {
          '200': json(ref('SkillPage'), 'A page of skills.'),
          '400': error('Invalid paging.'),
          ...common,
        },
      },
    },
    '/api/v1/search': {
      get: {
        summary: 'Ranked search',
        operationId: 'search',
        parameters: [{ ...query('q', 'Search text.'), required: true }, ...filters, ...paging],
        responses: {
          '200': json(ref('SkillPage'), 'Matching skills, best first.'),
          '400': error('Missing q or invalid paging.'),
          ...common,
        },
      },
    },
    '/api/v1/suggest': {
      get: {
        summary: 'Skill-name completions',
        operationId: 'suggest',
        parameters: [query('q', 'Partly typed name.')],
        responses: {
          '200': json(
            {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      slug: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
            'Up to eight completions.',
          ),
          ...common,
        },
      },
    },
    '/api/v1/categories': {
      get: {
        summary: 'Categories with counts',
        operationId: 'listCategories',
        responses: {
          '200': json(
            { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } },
            'Categories.',
          ),
          ...common,
        },
      },
    },
    '/api/v1/trending': {
      get: {
        summary: 'Trending skills',
        operationId: 'trending',
        parameters: paging,
        responses: {
          '200': json(
            {
              type: 'object',
              properties: {
                basis: { type: 'string' },
                data: { type: 'array', items: ref('Skill') },
              },
            },
            'Trending skills and the basis used.',
          ),
          ...common,
        },
      },
    },
    '/api/v1/skills/{id}': {
      get: {
        summary: 'One skill',
        operationId: 'getSkill',
        parameters: [idParam],
        responses: {
          '200': json(
            { type: 'object', properties: { data: ref('Skill') } },
            'The skill with files, compatibility and ranking signals.',
          ),
          '404': error('Not found.'),
          ...common,
        },
      },
    },
    '/api/v1/skills/{id}/versions': {
      get: {
        summary: 'Indexed versions',
        operationId: 'listVersions',
        parameters: [idParam],
        responses: {
          '200': json(
            { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } },
            'Versions, newest first.',
          ),
          '404': error('Not found.'),
          ...common,
        },
      },
    },
    '/api/v1/skills/{id}/security': {
      get: {
        summary: 'Security report for the current version',
        operationId: 'getSecurity',
        parameters: [idParam],
        responses: {
          '200': json(
            { type: 'object', properties: { data: ref('SecurityReport') } },
            'The report.',
          ),
          '404': error('Not found.'),
          ...common,
        },
      },
    },
    '/api/v1/skills/{id}/install': {
      get: {
        summary: 'Install, update and uninstall instructions',
        operationId: 'getInstall',
        parameters: [
          idParam,
          query('agent', 'Agent id.', { type: 'string', enum: ['claude-code', 'codex'] }),
          query('scope', 'Install scope.', {
            type: 'string',
            enum: ['project', 'global'],
            default: 'project',
          }),
          query('method', 'Install method.', {
            type: 'string',
            enum: ['symlink', 'copy', 'manual'],
            default: 'symlink',
          }),
          query('pin', 'Pin to the verified commit when there is one.', {
            type: 'string',
            enum: ['true', 'false'],
            default: 'true',
          }),
          query('shell', 'Shell to quote for.', {
            type: 'string',
            enum: ['posix', 'powershell'],
            default: 'posix',
          }),
        ],
        responses: {
          '200': json(
            { type: 'object', properties: { data: { type: 'object' } } },
            'The plan, or the reason none could be built.',
          ),
          '400': error('Invalid parameter.'),
          '404': error('Not found.'),
          ...common,
        },
      },
    },
    '/api/v1/repositories/{id}': {
      get: {
        summary: 'One repository',
        operationId: 'getRepository',
        parameters: [idParam],
        responses: {
          '200': json(
            { type: 'object', properties: { data: { type: 'object' } } },
            'The repository.',
          ),
          '404': error('Not found.'),
          ...common,
        },
      },
    },
    '/api/v1/submissions': {
      post: {
        summary: 'Suggest a GitHub repository',
        operationId: 'createSubmission',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repository'],
                properties: {
                  repository: {
                    type: 'string',
                    description: 'owner/repo or https://github.com/owner/repo',
                  },
                  note: { type: 'string', maxLength: 1000 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': json(ref('SubmissionResult'), 'Created.'),
          '200': json(ref('SubmissionResult'), 'Already suggested or listed: the existing record.'),
          '503': error('Submissions are closed.'),
          ...writeErrors,
        },
      },
    },
    '/api/v1/reports': {
      post: {
        summary: 'Report a problem',
        operationId: 'createReport',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'body'],
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'security_concern',
                      'false_positive',
                      'inaccurate_metadata',
                      'duplicate',
                      'takedown',
                      'other',
                    ],
                  },
                  skillId: {
                    type: 'string',
                    description: 'Required except for other and takedown.',
                  },
                  findingId: { type: 'string', description: 'Required for false_positive.' },
                  body: { type: 'string', minLength: 10, maxLength: 5000 },
                  contact: { type: 'string', maxLength: 200 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': json(ref('ReportResult'), 'Created.'),
          '200': json(
            ref('ReportResult'),
            'You already have an open report of this kind: that report.',
          ),
          ...writeErrors,
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
      Skill: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          verification: { type: 'string', enum: ['VERIFIED', 'UNVERIFIED', 'FLAGGED'] },
          lifecycle: {
            type: 'string',
            enum: ['PENDING', 'SCANNING', 'COMPLETE', 'EXPIRED', 'FAILED'],
          },
          agents: { type: 'array', items: { type: 'string' } },
          quality: { type: ['number', 'null'] },
          url: { type: 'string' },
        },
      },
      SkillPage: {
        type: 'object',
        properties: {
          data: { type: 'array', items: ref('Skill') },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              perPage: { type: 'integer' },
              total: { type: 'integer' },
              pages: { type: 'integer' },
            },
          },
        },
      },
      SecurityReport: {
        type: 'object',
        properties: {
          verification: { type: 'string' },
          lifecycle: { type: 'string' },
          expiresAt: { type: ['string', 'null'] },
          decision: { type: ['object', 'null'] },
          report: { type: ['object', 'null'] },
        },
      },
      SubmissionResult: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              repository: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string' },
            },
          },
          duplicate: { type: 'boolean' },
          alreadyIndexed: { type: 'boolean' },
        },
      },
      ReportResult: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string' },
            },
          },
          duplicate: { type: 'boolean' },
        },
      },
    },
  },
} as const;
