import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDefaultScanners, evaluateVerification, runScan } from '@skillxone/security';
import { parseSkillMd } from '@skillxone/skill-parser';

/**
 * The project publishes its own skill (skills/skillxone). It must hold itself to the same
 * bar as every indexed skill: valid under the open specification, and Verified by our own
 * scanners and policy with no findings above `low`.
 */
const path = fileURLToPath(new URL('../../../skills/skillxone/SKILL.md', import.meta.url));
const source = readFileSync(path, 'utf8');

describe('the skillxone skill', () => {
  it('is valid under the Agent Skills specification', () => {
    const parsed = parseSkillMd(source, 'skillxone');
    expect(parsed.issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(parsed.specValid).toBe(true);
    expect(parsed.name).toBe('skillxone');
  });

  it('passes the verification policy with no findings above low', async () => {
    const report = await runScan(
      {
        license: 'Apache-2.0',
        files: [
          {
            path: 'SKILL.md',
            kind: 'skill_md',
            content: source,
            sizeBytes: Buffer.byteLength(source),
            isExecutable: false,
            isBinary: false,
            blobSha: createHash('sha1').update(source).digest('hex'),
            truncated: false,
          },
        ],
      },
      { scanners: createDefaultScanners({ osv: null, gitleaksBinary: null }) },
    );
    const serious = report.findings.filter((f) => !['info', 'low'].includes(f.severity));
    expect(serious.map((f) => `${f.ruleId}:${f.lineStart}`)).toEqual([]);
    expect(evaluateVerification(report, { now: new Date() }).state).toBe('VERIFIED');
  });

  it('only ever points agents at skillxone.online', () => {
    const hosts = new Set([...source.matchAll(/https?:\/\/([^/\s)"`]+)/g)].map((m) => m[1]));
    expect([...hosts].sort()).toEqual(['github.com', 'skillxone.online']);
  });
});
