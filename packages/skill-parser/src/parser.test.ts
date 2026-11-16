import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  classifyFile,
  computeContentHash,
  detectDependencyManifests,
  extractReferences,
  guessCategory,
  inferAgentCompatibility,
  locateSkills,
  parseSkillMd,
} from './index';
import type { TreeEntry } from './index';

const bytes = (text: string) => new TextEncoder().encode(text);
const entry = (path: string, mode = '100644', size = 10): TreeEntry => ({
  path,
  sha: `sha-${path}`,
  size,
  mode,
});
const codes = (source: string, dir: string) => parseSkillMd(source, dir).issues.map((i) => i.code);

describe('computeContentHash (skills-lock.json v2 compatibility)', () => {
  // Test vectors published in the vercel-labs/skills README.
  it('matches the published vector for no files', () => {
    expect(computeContentHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published vector for a single file', () => {
    expect(computeContentHash([{ path: 'SKILL.md', content: bytes('# hi\n') }])).toBe(
      '93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55',
    );
  });

  it('matches the published vector for two files, in any input order', () => {
    const files = [
      { path: 'docs/b.md', content: bytes('b\n') },
      { path: 'SKILL.md', content: bytes('a\n') },
    ];
    const expected = 'b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24';
    expect(computeContentHash(files)).toBe(expected);
    expect(computeContentHash([...files].reverse())).toBe(expected);
  });

  it('agrees with the documented shell equivalent', () => {
    const viaShell = execFileSync(
      'sh',
      ['-c', "printf 'SKILL.md\\0002\\000a\\ndocs/b.md\\0002\\000b\\n' | shasum -a 256"],
      { encoding: 'utf8' },
    ).slice(0, 64);
    expect(viaShell).toBe('b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24');
  });

  it('normalises CRLF in text files but leaves binary files alone', () => {
    const lf = computeContentHash([{ path: 'SKILL.md', content: bytes('a\nb\n') }]);
    const crlf = computeContentHash([{ path: 'SKILL.md', content: bytes('a\r\nb\r\n') }]);
    expect(crlf).toBe(lf);

    const binaryLf = computeContentHash([{ path: 'x.bin', content: new Uint8Array([0, 10]) }]);
    const binaryCrlf = computeContentHash([
      { path: 'x.bin', content: new Uint8Array([0, 13, 10]) },
    ]);
    expect(binaryCrlf).not.toBe(binaryLf);
  });

  it('ignores metadata.json and tool cache folders', () => {
    const base = [{ path: 'SKILL.md', content: bytes('# hi\n') }];
    expect(
      computeContentHash([
        ...base,
        { path: 'metadata.json', content: bytes('{}') },
        { path: 'scripts/__pycache__/x.pyc', content: bytes('x') },
        { path: '.git/config', content: bytes('x') },
      ]),
    ).toBe(computeContentHash(base));
  });

  it('sorts by bytes, not by locale', () => {
    const a = { path: 'Z.md', content: bytes('1') };
    const b = { path: 'a.md', content: bytes('2') };
    expect(computeContentHash([a, b])).toBe(computeContentHash([b, a]));
    // "Z" (0x5a) sorts before "a" (0x61) in byte order.
    const manual = computeContentHash([a]) === computeContentHash([b]);
    expect(manual).toBe(false);
  });
});

describe('parseSkillMd', () => {
  const valid =
    '---\nname: pdf-processing\ndescription: Extract text from PDFs.\nlicense: Apache-2.0\nmetadata:\n  author: example\n  version: "1.0"\n---\n# PDF\n\nBody.\n';

  it('accepts a valid skill', () => {
    const parsed = parseSkillMd(valid, 'pdf-processing');
    expect(parsed.specValid).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.name).toBe('pdf-processing');
    expect(parsed.description).toBe('Extract text from PDFs.');
    expect(parsed.license).toBe('Apache-2.0');
    expect(parsed.metadata).toEqual({ author: 'example', version: '1.0' });
    expect(parsed.body).toBe('# PDF\n\nBody.\n');
  });

  it('reports missing frontmatter but still returns a usable name', () => {
    const parsed = parseSkillMd('# Just a heading\n', 'my-skill');
    expect(parsed.specValid).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toContain('MISSING_FRONTMATTER');
    expect(parsed.name).toBe('my-skill');
  });

  it('reports invalid YAML without throwing', () => {
    expect(codes('---\nname: [unclosed\ndescription: x\n---\nbody', 'x')).toContain(
      'MALFORMED_FRONTMATTER',
    );
  });

  it('reports frontmatter that is not a mapping', () => {
    expect(codes('---\n- a\n- b\n---\nbody', 'x')).toContain('FRONTMATTER_NOT_A_MAPPING');
  });

  it.each([
    ['PDF-Processing', 'uppercase'],
    ['-pdf', 'leading hyphen'],
    ['pdf-', 'trailing hyphen'],
    ['pdf--processing', 'double hyphen'],
    ['pdf processing', 'space'],
    ['a'.repeat(65), 'too long'],
  ])('rejects the name %j (%s)', (name) => {
    expect(codes(`---\nname: "${name}"\ndescription: x\n---\nbody`, name)).toContain(
      'INVALID_NAME',
    );
  });

  it('reports a name that differs from its directory', () => {
    expect(codes('---\nname: one\ndescription: x\n---\nbody', 'two')).toContain(
      'NAME_DIRECTORY_MISMATCH',
    );
  });

  it('reports missing and over-long fields', () => {
    expect(codes('---\nname: x\n---\nbody', 'x')).toContain('MISSING_DESCRIPTION');
    expect(codes(`---\nname: x\ndescription: ${'d'.repeat(1025)}\n---\nbody`, 'x')).toContain(
      'DESCRIPTION_TOO_LONG',
    );
    expect(
      codes(`---\nname: x\ndescription: d\ncompatibility: ${'c'.repeat(501)}\n---\nbody`, 'x'),
    ).toContain('COMPATIBILITY_TOO_LONG');
  });

  it('records agent-specific keys as extensions, not errors', () => {
    const parsed = parseSkillMd(
      '---\nname: x\ndescription: d\ncontext: fork\ndisable-model-invocation: true\n---\nbody',
      'x',
    );
    expect(parsed.specValid).toBe(true);
    expect(parsed.extensionKeys).toEqual(['context', 'disable-model-invocation']);
  });

  it('accepts an allowed-tools list with a warning', () => {
    const parsed = parseSkillMd(
      '---\nname: x\ndescription: d\nallowed-tools:\n  - Read\n  - Grep\n---\nbody',
      'x',
    );
    expect(parsed.allowedTools).toBe('Read Grep');
    expect(parsed.specValid).toBe(true);
    expect(parsed.issues[0]?.level).toBe('warning');
  });

  it('survives hostile YAML: alias bombs, custom tags and prototype keys', () => {
    const bomb =
      '---\na: &a ["x","x","x","x","x","x","x","x","x"]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: [*d,*d,*d,*d,*d,*d,*d,*d,*d]\nname: x\ndescription: d\n---\nbody';
    expect(() => parseSkillMd(bomb, 'x')).not.toThrow();

    const tagged = parseSkillMd(
      '---\nname: x\ndescription: !!js/function "function(){}"\n---\nb',
      'x',
    );
    expect(typeof tagged.description).toBe('string');

    const polluted = parseSkillMd(
      '---\nname: x\ndescription: d\n__proto__:\n  polluted: yes\n---\nb',
      'x',
    );
    expect(Object.keys(polluted.frontmatter)).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles CRLF files and a byte-order mark', () => {
    const parsed = parseSkillMd('\uFEFF---\r\nname: x\r\ndescription: d\r\n---\r\nBody\r\n', 'x');
    expect(parsed.specValid).toBe(true);
    expect(parsed.body).toBe('Body\r\n');
  });

  it('truncates an oversized file and says so', () => {
    const parsed = parseSkillMd(`---\nname: x\ndescription: d\n---\n${'a'.repeat(600_000)}`, 'x');
    expect(parsed.issues.map((i) => i.code)).toContain('FILE_TOO_LARGE');
    expect(parsed.body.length).toBeLessThanOrEqual(512 * 1024);
  });
});

describe('locateSkills', () => {
  it('finds several independent skills and assigns files to the nearest one', () => {
    const skills = locateSkills(
      [
        entry('README.md'),
        entry('skills/alpha/SKILL.md'),
        entry('skills/alpha/scripts/run.sh', '100755'),
        entry('skills/alpha/references/guide.md'),
        entry('skills/beta/SKILL.md'),
        entry('skills/beta/assets/logo.png'),
        entry('src/index.ts'),
      ],
      { repositoryName: 'repo' },
    );
    expect(skills.map((s) => s.directory)).toEqual(['skills/alpha', 'skills/beta']);
    expect(skills[0]?.directoryName).toBe('alpha');
    expect(skills[0]?.files.map((f) => f.relativePath)).toEqual([
      'SKILL.md',
      'scripts/run.sh',
      'references/guide.md',
    ]);
    expect(skills[1]?.files.find((f) => f.relativePath === 'assets/logo.png')?.isBinary).toBe(true);
  });

  it('supports category layouts and agent-specific directories', () => {
    const skills = locateSkills(
      [
        entry('skills/data/sql/SKILL.md'),
        entry('.claude/skills/review/SKILL.md'),
        entry('.agents/skills/deploy/SKILL.md'),
      ],
      { repositoryName: 'repo' },
    );
    expect(skills.map((s) => s.directory)).toEqual([
      '.agents/skills/deploy',
      '.claude/skills/review',
      'skills/data/sql',
    ]);
  });

  it('keeps nested skills separate', () => {
    const skills = locateSkills(
      [
        entry('pack/SKILL.md'),
        entry('pack/a.md'),
        entry('pack/sub/SKILL.md'),
        entry('pack/sub/b.md'),
      ],
      { repositoryName: 'repo' },
    );
    expect(skills.find((s) => s.directory === 'pack')?.files.map((f) => f.relativePath)).toEqual([
      'SKILL.md',
      'a.md',
    ]);
    expect(
      skills.find((s) => s.directory === 'pack/sub')?.files.map((f) => f.relativePath),
    ).toEqual(['SKILL.md', 'b.md']);
  });

  it('limits a root skill to SKILL.md and conventional folders', () => {
    const skills = locateSkills(
      [entry('SKILL.md'), entry('scripts/a.sh'), entry('src/big.ts'), entry('README.md')],
      { repositoryName: 'my-repo' },
    );
    expect(skills).toHaveLength(1);
    expect(skills[0]?.directory).toBe('');
    expect(skills[0]?.directoryName).toBe('my-repo');
    expect(skills[0]?.files.map((f) => f.relativePath)).toEqual(['SKILL.md', 'scripts/a.sh']);
  });

  it('ignores vendored copies and files with a different case', () => {
    expect(
      locateSkills(
        [entry('node_modules/pkg/SKILL.md'), entry('docs/skill.md'), entry('x/Skill.md')],
        {
          repositoryName: 'r',
        },
      ),
    ).toEqual([]);
  });

  it('caps the number of skills and files', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(`s/skill-${String(i).padStart(2, '0')}/SKILL.md`),
    );
    expect(locateSkills(many, { repositoryName: 'r', maxSkills: 5 })).toHaveLength(5);

    const big = [
      entry('one/SKILL.md'),
      ...Array.from({ length: 20 }, (_, i) => entry(`one/f${i}.md`)),
    ];
    const [skill] = locateSkills(big, { repositoryName: 'r', maxFilesPerSkill: 5 });
    expect(skill?.files).toHaveLength(5);
    expect(skill?.truncated).toBe(true);
  });
});

describe('file classification and analysis', () => {
  it('classifies files', () => {
    expect(classifyFile('SKILL.md', '100644').kind).toBe('skill_md');
    expect(classifyFile('scripts/run.py', '100644').kind).toBe('script');
    expect(classifyFile('bin/tool', '100755')).toMatchObject({
      kind: 'script',
      isExecutable: true,
    });
    expect(classifyFile('package.json', '100644').kind).toBe('manifest');
    expect(classifyFile('assets/a.PNG', '100644')).toMatchObject({
      kind: 'binary',
      isBinary: true,
    });
    expect(classifyFile('link', '120000').isSymlink).toBe(true);
    expect(classifyFile('config.yaml', '100644').kind).toBe('config');
  });

  const files = locateSkills(
    [
      entry('.claude/skills/x/SKILL.md'),
      entry('.claude/skills/x/requirements.txt'),
      entry('.claude/skills/x/references/guide.md'),
    ],
    { repositoryName: 'r' },
  )[0]!.files;

  it('infers agent compatibility with evidence', () => {
    const parsed = parseSkillMd('---\nname: x\ndescription: d\ncontext: fork\n---\nb', 'x');
    const result = inferAgentCompatibility('.claude/skills/x', parsed, files);
    expect(result.find((r) => r.agentId === 'claude-code')?.level).toBe('declared');
    const codex = result.find((r) => r.agentId === 'codex');
    expect(codex?.level).toBe('inferred');
    expect(codex?.warnings[0]).toContain('context');
  });

  it('detects dependency manifests', () => {
    expect(detectDependencyManifests(files)).toEqual([
      { path: 'requirements.txt', ecosystem: 'PyPI' },
    ]);
  });

  it('extracts relative references and checks they exist', () => {
    const refs = extractReferences(
      'See [guide](references/guide.md#top), [gone](./missing.md), [site](https://example.com), [up](../x.md) and [abs](/etc/passwd).',
      files,
    );
    expect(refs).toEqual([
      { path: 'references/guide.md', exists: true },
      { path: 'missing.md', exists: false },
    ]);
  });

  it('guesses a category and falls back to other', () => {
    expect(guessCategory('dockerfile-reviewer', 'Reviews a Dockerfile')).toBe('devops');
    expect(guessCategory('pdf-forms', 'Fill PDF forms')).toBe('documents');
    expect(guessCategory('zzz', 'qqq')).toBe('other');
  });
});
