import { REPORT_TYPES } from '@skillxone/database';
import type { Report, ReportType, Submission } from '@skillxone/database';
import { parseRepoRef } from '@skillxone/github';
import { apiError, clientKey } from './api';
import { createRateLimiter } from './rate-limit';
import type { RateLimiter } from './rate-limit';

/**
 * Validation and shaping for the two public write endpoints. Pure where possible so the
 * rules are unit-tested; the route handlers only wire them to the database.
 */

export const MAX_BODY_BYTES = 8 * 1024;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface SubmissionBody {
  owner: string;
  repo: string;
  note: string | null;
}

export interface ReportBody {
  type: ReportType;
  skillId: string | null;
  findingId: string | null;
  body: string;
  contact: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const hasControl = (text: string) => /[\p{Cc}]/u.test(text.replace(/[\n\r\t]/g, ''));

function optionalText(value: unknown, field: string, max: number): Parsed<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: `"${field}" must be a string.` };
  const text = value.trim();
  if (text.length > max)
    return { ok: false, message: `"${field}" must be at most ${max} characters.` };
  if (hasControl(text)) return { ok: false, message: `"${field}" contains control characters.` };
  return { ok: true, value: text || null };
}

export function parseSubmissionBody(data: unknown): Parsed<SubmissionBody> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, message: 'Send a JSON object.' };
  const { repository, note } = data as Record<string, unknown>;
  if (typeof repository !== 'string')
    return {
      ok: false,
      message: '"repository" is required: owner/repo or a https://github.com URL.',
    };
  const ref = parseRepoRef(repository);
  if (!ref)
    return {
      ok: false,
      message: '"repository" must be owner/repo or a https://github.com/owner/repo URL.',
    };
  const parsedNote = optionalText(note, 'note', 1000);
  if (!parsedNote.ok) return parsedNote;
  return { ok: true, value: { owner: ref.owner, repo: ref.repo, note: parsedNote.value } };
}

export function parseReportBody(data: unknown): Parsed<ReportBody> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, message: 'Send a JSON object.' };
  const input = data as Record<string, unknown>;
  if (typeof input.type !== 'string' || !REPORT_TYPES.includes(input.type as ReportType)) {
    return { ok: false, message: `"type" must be one of: ${REPORT_TYPES.join(', ')}.` };
  }
  for (const field of ['skillId', 'findingId'] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && (typeof value !== 'string' || !ID.test(value))) {
      return { ok: false, message: `"${field}" is not a valid id.` };
    }
  }
  if (typeof input.body !== 'string') return { ok: false, message: '"body" is required.' };
  const body = input.body.trim();
  if (body.length < 10 || body.length > 5000)
    return { ok: false, message: '"body" must be 10 to 5000 characters.' };
  if (hasControl(body)) return { ok: false, message: '"body" contains control characters.' };
  const contact = optionalText(input.contact, 'contact', 200);
  if (!contact.ok) return contact;
  const skillId = (input.skillId as string | undefined) ?? null;
  const findingId = (input.findingId as string | undefined) ?? null;
  if (input.type !== 'other' && input.type !== 'takedown' && !skillId) {
    return { ok: false, message: '"skillId" is required for this report type.' };
  }
  if (input.type === 'false_positive' && !findingId) {
    return { ok: false, message: '"findingId" is required for a false-positive report.' };
  }
  return {
    ok: true,
    value: { type: input.type as ReportType, skillId, findingId, body, contact: contact.value },
  };
}

/** Reads a JSON body with a size cap and a JSON content type (which also forces a CORS preflight). */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/i.test(type)) {
    return {
      ok: false,
      response: apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as application/json.'),
    };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES)
    return {
      ok: false,
      response: apiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'),
    };
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'),
    };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError(400, 'INVALID_REQUEST', 'The body is not valid JSON.') };
  }
}

const globalStore = globalThis as typeof globalThis & {
  __skillxoneWriteLimiter?: RateLimiter;
  __skillxoneSharedWriteLimiter?: RateLimiter;
};

/**
 * Write limits: 10 an hour per client. Without a trusted proxy every caller looks the same,
 * so they share one larger bucket instead.
 */
export function checkWriteLimit(request: Request): Response | null {
  const key = clientKey(request);
  const limiter =
    key === 'direct'
      ? (globalStore.__skillxoneSharedWriteLimiter ??= createRateLimiter({
          limit: 120,
          windowMs: 3_600_000,
        }))
      : (globalStore.__skillxoneWriteLimiter ??= createRateLimiter({
          limit: 10,
          windowMs: 3_600_000,
        }));
  const result = limiter.check(key);
  if (result.allowed) return null;
  return apiError(429, 'RATE_LIMITED', 'Too many submissions from this address. Try again later.', {
    'Retry-After': String(result.retryAfter),
  });
}

export const serializeSubmission = (submission: Submission) => ({
  id: submission.id,
  repository: submission.repo_full_name_lower,
  status: submission.status,
  createdAt: submission.created_at,
});

export const serializeReport = (report: Report) => ({
  id: report.id,
  type: report.type,
  skillId: report.skill_id,
  findingId: report.finding_id,
  status: report.status,
  createdAt: report.created_at,
});
