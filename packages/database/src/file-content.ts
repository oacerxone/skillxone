import { gunzipSync, gzipSync } from 'node:zlib';
import type { SkillFilesTable } from './types';

/**
 * Stored file text is compressed, except SKILL.md: SQL reads SKILL.md directly (the search
 * index and ranking), and it is the file shown on every skill page. Everything else is read
 * one file at a time, so it is stored as gzip encoded in base64 and decoded here.
 *
 * The encoding is recorded in its own column, never inferred from the text, so a file in a
 * repository cannot make itself look like compressed data.
 */

export type ContentEncoding = 'gzip-base64';
export const GZIP_BASE64: ContentEncoding = 'gzip-base64';

/** Shorter texts gain little and are left as they are. */
const MIN_COMPRESS_CHARS = 512;
/** Stored files are at most 512 KiB; this bounds decompression of anything unexpected. */
const MAX_DECODED_BYTES = 4 * 1024 * 1024;

export interface EncodedContent {
  content: string | null;
  content_encoding: ContentEncoding | null;
}

export function encodeFileContent(
  kind: SkillFilesTable['kind'],
  content: string | null,
): EncodedContent {
  if (content === null || kind === 'skill_md' || content.length < MIN_COMPRESS_CHARS) {
    return { content, content_encoding: null };
  }
  const packed = gzipSync(Buffer.from(content, 'utf8'), { level: 9 }).toString('base64');
  return packed.length < content.length
    ? { content: packed, content_encoding: GZIP_BASE64 }
    : { content, content_encoding: null };
}

/** Plain text of a stored file, or null if it was not stored or cannot be decoded. */
export function decodeFileContent(
  content: string | null,
  encoding: string | null | undefined,
): string | null {
  if (content === null) return null;
  if (!encoding) return content;
  if (encoding !== GZIP_BASE64) return null;
  try {
    return gunzipSync(Buffer.from(content, 'base64'), {
      maxOutputLength: MAX_DECODED_BYTES,
    }).toString('utf8');
  } catch {
    return null;
  }
}
