/**
 * Finds skills in a repository file listing and classifies their files.
 * Works on paths and metadata only; no file content is read here.
 */

export interface TreeEntry {
  /** Repository-relative path with `/` separators. */
  path: string;
  /** Git blob SHA. */
  sha: string;
  size: number;
  /** Git file mode, e.g. `100644`, `100755` (executable), `120000` (symlink). */
  mode: string;
}

export type FileKind =
  'skill_md' | 'markdown' | 'script' | 'manifest' | 'config' | 'binary' | 'other';

export interface SkillFileEntry extends TreeEntry {
  /** Path relative to the skill directory. */
  relativePath: string;
  kind: FileKind;
  isExecutable: boolean;
  isBinary: boolean;
  isSymlink: boolean;
}

export interface SkillLocation {
  /** Skill directory relative to the repository root; `''` when SKILL.md is at the root. */
  directory: string;
  /** Last path segment of the directory, or the repository name for a root skill. */
  directoryName: string;
  files: SkillFileEntry[];
  /** True when the file list was cut at `maxFilesPerSkill`. */
  truncated: boolean;
}

export interface LocateOptions {
  repositoryName: string;
  maxSkills?: number;
  maxFilesPerSkill?: number;
}

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '__pycache__',
]);
/** Conventional skill sub-folders; the only ones collected for a skill at the repository root. */
const ROOT_SKILL_DIRS = [
  'scripts/',
  'references/',
  'assets/',
  'agents/',
  'examples/',
  'templates/',
];

const SCRIPT_EXT = /\.(sh|bash|zsh|fish|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|go|rs|lua|swift)$/i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|tar|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|class|pyc|o|a|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|wav|ogg|sqlite|db|docx?|xlsx?|pptx?)$/i;
const MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'Gemfile',
  'Gemfile.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
]);
const CONFIG_EXT = /\.(json|ya?ml|toml|ini|cfg|conf|env|xml)$/i;

export function classifyFile(
  relativePath: string,
  mode: string,
): Omit<SkillFileEntry, keyof TreeEntry | 'relativePath'> {
  const name = relativePath.split('/').pop() ?? relativePath;
  const isSymlink = mode === '120000';
  const isExecutable = mode === '100755';
  const isBinary = BINARY_EXT.test(name);
  let kind: FileKind = 'other';
  if (relativePath === 'SKILL.md') kind = 'skill_md';
  else if (isBinary) kind = 'binary';
  else if (MANIFESTS.has(name)) kind = 'manifest';
  else if (SCRIPT_EXT.test(name) || isExecutable) kind = 'script';
  else if (/\.(md|mdx|markdown|txt|rst)$/i.test(name)) kind = 'markdown';
  else if (CONFIG_EXT.test(name)) kind = 'config';
  return { kind, isExecutable, isBinary, isSymlink };
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function isIgnored(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_SEGMENTS.has(segment));
}

/**
 * A directory is a skill when it directly contains a file named exactly `SKILL.md`.
 * Files belong to the nearest enclosing skill directory, so nested skills stay separate.
 */
export function locateSkills(
  entries: readonly TreeEntry[],
  options: LocateOptions,
): SkillLocation[] {
  const maxSkills = options.maxSkills ?? 500;
  const maxFiles = options.maxFilesPerSkill ?? 200;

  const skillDirs = entries
    .filter(
      (entry) =>
        (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')) && !isIgnored(entry.path),
    )
    .map((entry) => dirname(entry.path))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, maxSkills);
  const dirSet = new Set(skillDirs);
  const hasRootSkill = dirSet.has('');

  const locations = new Map<string, SkillLocation>(
    skillDirs.map((directory) => [
      directory,
      {
        directory,
        directoryName: directory
          ? (directory.split('/').pop() ?? directory)
          : options.repositoryName,
        files: [],
        truncated: false,
      },
    ]),
  );

  /** Nearest ancestor (or self) directory that is a non-root skill. */
  const owningSkill = (path: string): string | undefined => {
    let dir = dirname(path);
    for (;;) {
      if (dir !== '' && dirSet.has(dir)) return dir;
      if (dir === '') return undefined;
      dir = dirname(dir);
    }
  };

  for (const entry of entries) {
    if (isIgnored(entry.path)) continue;
    let owner = owningSkill(entry.path);
    if (owner === undefined) {
      // A root skill owns only SKILL.md and the conventional sub-folders, never the whole repository.
      const belongsToRoot =
        hasRootSkill &&
        (entry.path === 'SKILL.md' ||
          ROOT_SKILL_DIRS.some((prefix) => entry.path.startsWith(prefix)));
      if (!belongsToRoot) continue;
      owner = '';
    }
    const location = locations.get(owner);
    if (!location) continue;
    if (location.files.length >= maxFiles) {
      location.truncated = true;
      continue;
    }
    const relativePath = owner === '' ? entry.path : entry.path.slice(owner.length + 1);
    location.files.push({ ...entry, relativePath, ...classifyFile(relativePath, entry.mode) });
  }

  return [...locations.values()];
}
