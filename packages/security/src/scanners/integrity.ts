import { excerptOf, MAX_LINES } from '../text';
import { makeFinding } from '../rules';
import type { Finding, Scanner, ScanFile, ScanInput } from '../types';
import type { Severity } from '@skillxone/shared';

/**
 * Repository integrity: what is in the skill directory and how it changed, from tree
 * metadata alone.
 */

const ARCHIVE = /\.(?:zip|tar|gz|tgz|bz2|xz|7z|rar|jar|war|whl)$/i;
const EXECUTABLE_BINARY = /\.(?:exe|dll|so|dylib|bin|wasm|class|pyc|o|a|msi|app|dmg|pkg|deb|rpm)$/i;
const DOCUMENT_OR_MEDIA =
  /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|svg|pdf|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|wav|ogg|docx?|xlsx?|pptx?|odt|ods|odp)$/i;
const SCRIPT = /\.(?:sh|bash|zsh|fish|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|lua)$/i;

const rule = (id: string, explanation: string, remediation: string) => ({
  id,
  category: 'integrity' as const,
  explanation,
  remediation,
});

const RULES = {
  binaryArchive: rule(
    'INT-ARCHIVE',
    'The skill ships an archive. Its contents cannot be reviewed here and were not scanned.',
    'Commit the files themselves instead of an archive.',
  ),
  binaryExecutable: rule(
    'INT-BINARY-EXECUTABLE',
    'The skill ships a compiled binary or library. It cannot be reviewed here and was not scanned.',
    'Ship source code, or explain where the binary comes from and how to check it.',
  ),
  binaryUnknown: rule(
    'INT-BINARY-FILE',
    'The skill ships a binary file of an unknown type. It was not scanned.',
    'Remove the file, or explain what it is for.',
  ),
  binaryAsset: rule(
    'INT-BINARY-ASSET',
    'The skill ships an image, font, media file or office document. It was not scanned.',
    'None required. Informational.',
  ),
  executableScript: rule(
    'INT-EXECUTABLE-SCRIPT',
    'The skill ships an executable script. Review it before allowing an agent to run it.',
    'None required. Informational.',
  ),
  executableOther: rule(
    'INT-EXECUTABLE-NON-SCRIPT',
    'A file that is not a script has its executable bit set.',
    'Clear the executable bit (chmod -x) unless the file is meant to be run.',
  ),
  unscanned: rule(
    'INT-UNSCANNED-FILE',
    'A text file was not stored in full (it is a symbolic link, exceeds the size limit or could not be fetched), so it was not fully scanned.',
    'Keep skill files below the size limit and avoid symbolic links.',
  ),
  missingLicense: rule(
    'INT-MISSING-LICENSE',
    'Neither the skill nor its repository states a license, so the terms of use are unclear.',
    'Add a LICENSE file to the repository or a `license` field to SKILL.md.',
  ),
  changedSinceVerified: rule(
    'INT-CHANGED-SINCE-VERIFIED',
    'This file was added or changed since the last verified version.',
    'None required. Review the change if you trusted the earlier version.',
  ),
  ownerChanged: rule(
    'INT-OWNER-CHANGED',
    'The repository moved to a different owner since the skill was last verified. The new owner now controls the content.',
    'A maintainer reviews the change and accepts this finding once satisfied.',
  ),
  broadTools: rule(
    'INT-BROAD-ALLOWED-TOOLS',
    'SKILL.md pre-approves unrestricted shell access through `allowed-tools`, so the agent may run commands without asking.',
    'Restrict the tool, for example `Bash(git status:*)`, or leave approval to the user.',
  ),
};

function binaryRule(file: ScanFile): {
  rule: (typeof RULES)[keyof typeof RULES];
  severity: Severity;
} {
  if (ARCHIVE.test(file.path)) return { rule: RULES.binaryArchive, severity: 'medium' };
  if (EXECUTABLE_BINARY.test(file.path))
    return { rule: RULES.binaryExecutable, severity: 'medium' };
  if (DOCUMENT_OR_MEDIA.test(file.path)) return { rule: RULES.binaryAsset, severity: 'info' };
  return { rule: RULES.binaryUnknown, severity: 'medium' };
}

function frontmatterLines(file: ScanFile): string[] {
  const content = file.content ?? '';
  const match = /^\uFEFF?---\r?\n([\s\S]{0,20000}?)\r?\n---/.exec(content);
  return match ? match[1]!.split(/\r?\n/) : [];
}

export function integrityFindings(input: ScanInput): Finding[] {
  const findings: Finding[] = [];
  for (const file of input.files) {
    if (file.isBinary || file.kind === 'binary') {
      const { rule, severity } = binaryRule(file);
      findings.push(makeFinding(rule, severity, file, null, null, file.path));
    } else if (file.content === null || file.truncated) {
      findings.push(makeFinding(RULES.unscanned, 'medium', file, null, null, file.path));
    } else if ((file.content.match(/\n/g)?.length ?? 0) >= MAX_LINES) {
      findings.push(
        makeFinding(
          {
            ...RULES.unscanned,
            explanation: `The file has more than ${MAX_LINES} lines; only the first ${MAX_LINES} were scanned.`,
          },
          'medium',
          file,
          null,
          null,
          file.path,
        ),
      );
    }
    if (file.isExecutable) {
      const script = SCRIPT.test(file.path) || file.kind === 'script';
      findings.push(
        makeFinding(
          script ? RULES.executableScript : RULES.executableOther,
          script ? 'info' : 'low',
          file,
          script ? 1 : null,
          script && file.content ? excerptOf(file.content.split(/\r?\n/, 1)[0] ?? '') : null,
          file.path,
        ),
      );
    }
  }

  if (!input.license)
    findings.push(makeFinding(RULES.missingLicense, 'low', null, null, null, 'license'));

  const skillMd = input.files.find((file) => file.kind === 'skill_md');
  if (skillMd) {
    const lines = frontmatterLines(skillMd);
    const index = lines.findIndex((line) => /^allowed-tools\s*:/i.test(line));
    if (index >= 0) {
      // The value may sit on the same line or on indented list lines below it.
      const block = [lines[index]!];
      for (const next of lines.slice(index + 1)) {
        if (/^\s+(?:-\s)?\S/.test(next)) block.push(next);
        else break;
      }
      const value = block.join(' ');
      if (/\bBash\b(?!\s*\()/.test(value) || /\bBash\(\s*\*\s*\)/.test(value)) {
        findings.push(
          makeFinding(
            RULES.broadTools,
            'info',
            skillMd,
            index + 2,
            excerptOf(value),
            'allowed-tools: Bash',
          ),
        );
      }
    }
  }

  if (input.previousFiles) {
    const before = new Map(input.previousFiles.map((file) => [file.path, file.blobSha]));
    for (const file of input.files) {
      const relevant =
        file.kind === 'script' ||
        file.kind === 'skill_md' ||
        file.kind === 'manifest' ||
        file.isExecutable;
      if (relevant && before.get(file.path) !== file.blobSha) {
        findings.push(
          makeFinding(
            {
              ...RULES.changedSinceVerified,
              explanation: before.has(file.path)
                ? RULES.changedSinceVerified.explanation.replace('added or changed', 'changed')
                : RULES.changedSinceVerified.explanation.replace('added or changed', 'added'),
            },
            'info',
            file,
            null,
            null,
            `${file.path}:${file.blobSha}`,
          ),
        );
      }
    }
  }

  if (input.ownerChangedTo) {
    findings.push(
      makeFinding(
        RULES.ownerChanged,
        'medium',
        null,
        null,
        input.ownerChangedTo,
        `owner:${input.ownerChangedTo}`,
      ),
    );
  }
  return findings;
}

export const integrityScanner: Scanner = {
  id: 'integrity',
  version: '1.0.0',
  required: true,
  scan: (input) => ({ findings: integrityFindings(input) }),
};
