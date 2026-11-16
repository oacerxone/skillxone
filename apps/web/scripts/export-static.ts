/**
 * Static catalog export (deployment Mode C).
 *
 *   pnpm export:static [outDir]      (default: out-static/)
 *
 * Reads the database and writes a self-contained folder of HTML, JSON and one small script
 * that any static host can serve: list and detail pages, category pages, a client-side search
 * page with a MiniSearch index, and read-only JSON files mirroring the REST API's GET routes.
 *
 * It reuses the web app's sanitising Markdown pipeline, the installer package and the API
 * serialisers, so the static site shows the same content and the same commands. There is no
 * server: no submissions, reports, rate limiting, admin or live data. Forms become links to
 * the repository's issue templates.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { getSkillBySlug, listCategories, listSkills, openDatabase } from '@skillxone/database';
import type { SkillDetail, SkillListItem } from '@skillxone/database';
import { AGENTS, buildInstallPlan } from '@skillxone/installer';
import { findWorkspaceRoot, loadRootEnvFile, parseEnv } from '@skillxone/shared';
import { serializeSecurity, serializeSkill, serializeSkillDetail } from '../lib/api-serialize';
import { markdownToHast, stripFrontmatter } from '../lib/markdown';

const root = findWorkspaceRoot();
const outDir = resolve(process.argv[2] ?? join(root, 'out-static'));
const repositoryUrl = (
  process.env.NEXT_PUBLIC_REPOSITORY_URL ?? 'https://github.com/skillxone/skillxone'
).replace(/\/$/, '');
const generatedAt = new Date();

// ---------------------------------------------------------------------------------------
// HTML helpers. Every interpolated value goes through `esc` unless it is sanitised HTML.

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Depth-relative prefix so the export works from any sub-path (GitHub Pages project sites). */
const up = (depth: number) => (depth === 0 ? './' : '../'.repeat(depth));
const skillPath = (slug: string) => `skills/${slug}/`;

function write(relative: string, content: string): void {
  const target = join(outDir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const BADGE: Record<string, string> = {
  VERIFIED: 'Verified',
  UNVERIFIED: 'Unverified',
  FLAGGED: 'Flagged',
};
const badge = (state: string) =>
  `<span class="badge badge-${esc(state.toLowerCase())}">${esc(BADGE[state] ?? state)}</span>`;

function page(options: {
  title: string;
  depth: number;
  body: string;
  description?: string;
}): string {
  const base = up(options.depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} — skillxone</title>
<meta name="description" content="${esc(options.description ?? 'A static snapshot of the skillxone agent skills catalog.')}">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="${base}assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap">
<a class="brand" href="${base}">skillxone</a>
<nav aria-label="Primary"><a href="${base}">Catalog</a> <a href="${base}search/">Search</a> <a href="${base}categories/">Categories</a> <a href="${esc(repositoryUrl)}" rel="noopener noreferrer">GitHub</a></nav>
</div></header>
<main id="main" class="wrap">
${options.body.replace(/<pre>/g, '<pre tabindex="0">')}
</main>
<footer class="site-footer"><div class="wrap">
<p>Static snapshot generated ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC. Data is as fresh as the last build; there is no live data, account or form on this site. Open source under Apache-2.0; indexed skills keep their own licenses.</p>
</div></footer>
</body>
</html>
`;
}

function skillRow(skill: SkillListItem, depth: number): string {
  return `<li class="row"><a href="${up(depth)}${skillPath(skill.slug)}"><strong>${esc(skill.name)}</strong></a> ${badge(skill.verificationState)}
<span class="muted mono">${esc(skill.owner)}/${esc(skill.repo)}</span>
<p>${esc(skill.description)}</p></li>`;
}

// ---------------------------------------------------------------------------------------

function stylesheet(): string {
  const tokens = readFileSync(join(root, 'packages/ui/src/tokens.css'), 'utf8');
  // Follow the visitor's colour scheme: the dark token block also applies under the media query.
  const dark = /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/.exec(tokens)?.[1] ?? '';
  return `${tokens}
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {${dark}} }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px} a{color:var(--accent)} a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-9999px} .skip:focus{left:16px;top:8px;background:var(--bg);padding:4px 8px}
.site-header{border-bottom:1px solid var(--border)} .site-header .wrap{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding-top:12px;padding-bottom:12px}
.brand{font-weight:600;color:var(--text);text-decoration:none} nav a{margin-right:12px}
h1{font-size:28px;line-height:34px;margin:28px 0 8px} h2{font-size:20px;margin:28px 0 8px} .muted{color:var(--text-muted)} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.list{list-style:none;padding:0;margin:0} .row{border-bottom:1px solid var(--border);padding:12px 0} .row p{margin:4px 0 0}
.badge{display:inline-block;font-size:12px;line-height:18px;padding:0 6px;border-radius:4px;margin-left:6px}
.badge-verified{background:var(--verified-bg);color:var(--verified-fg)} .badge-unverified{background:var(--unverified-bg);color:var(--unverified-fg)} .badge-flagged{background:var(--flagged-bg);color:var(--flagged-fg)}
.panel{border:1px solid var(--border);border-radius:8px;padding:16px;margin:16px 0} pre{background:var(--bg-muted);padding:12px;border-radius:6px;overflow-x:auto;white-space:pre} code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.prose{overflow-wrap:anywhere} .prose table{border-collapse:collapse;display:block;overflow-x:auto} .prose td,.prose th{border:1px solid var(--border);padding:4px 8px}
.warn{background:var(--flagged-bg);color:var(--flagged-fg);padding:8px 12px;border-radius:6px} .note{background:var(--unverified-bg);color:var(--unverified-fg);padding:8px 12px;border-radius:6px}
input[type=search]{width:100%;max-width:520px;font:inherit;padding:8px 10px;border:1px solid var(--border-strong);border-radius:6px;background:var(--bg);color:var(--text)}
.site-footer{border-top:1px solid var(--border);margin-top:48px;padding:16px 0;font-size:13px;color:var(--text-muted)}
`;
}

const SEARCH_SCRIPT = `(function () {
  var input = document.getElementById('q');
  var status = document.getElementById('search-status');
  var list = document.getElementById('results');
  var base = document.documentElement.getAttribute('data-base') || '../';
  var index = null;
  function render(query) {
    if (!index) return;
    list.textContent = '';
    if (!query.trim()) { status.textContent = 'Type to search ' + index.documentCount + ' skills.'; return; }
    var results = index.search(query, { prefix: true, fuzzy: 0.15, combineWith: 'AND', boost: { name: 4, description: 2 } }).slice(0, 50);
    status.textContent = results.length === 0 ? 'No skills match.' : results.length + ' result' + (results.length === 1 ? '' : 's') + '.';
    results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'row';
      var link = document.createElement('a');
      link.href = base + 'skills/' + r.slug.split('/').map(encodeURIComponent).join('/') + '/';
      var name = document.createElement('strong');
      name.textContent = r.name;
      link.appendChild(name);
      var repo = document.createElement('span');
      repo.className = 'muted mono';
      repo.textContent = ' ' + r.repo;
      var description = document.createElement('p');
      description.textContent = r.description;
      li.appendChild(link);
      li.appendChild(repo);
      li.appendChild(description);
      list.appendChild(li);
    });
  }
  fetch(base + 'search/index.json').then(function (res) { return res.json(); }).then(function (data) {
    index = MiniSearch.loadJSON(JSON.stringify(data), { fields: ['name', 'description', 'repo', 'categories'], storeFields: ['slug', 'name', 'description', 'repo'] });
    var initial = new URLSearchParams(location.search).get('q') || '';
    input.value = initial;
    input.disabled = false;
    render(initial);
  }).catch(function () { status.textContent = 'The search index could not be loaded.'; });
  input.addEventListener('input', function () { render(input.value); });
})();
`;

// ---------------------------------------------------------------------------------------

/** SKILL.md sits under the page's h2, so its headings move down two levels (h1 becomes h3). */
function demoteHeadings(tree: Root): Root {
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const level = /^h([1-6])$/.exec(child.tagName)?.[1];
      if (level) child.tagName = `h${Math.min(6, Number(level) + 2)}`;
      visit(child);
    }
  };
  visit(tree);
  return tree;
}

function detailPage(skill: SkillDetail): string {
  const depth = 2 + skill.slug.split('/').length - 1;
  const repo = `https://github.com/${encodeURIComponent(skill.owner)}/${encodeURIComponent(skill.repo)}`;
  const ref = skill.currentVersion?.commitSha ?? skill.repository.defaultBranch ?? 'HEAD';
  const dir = skill.path ? `${skill.path.split('/').map(encodeURIComponent).join('/')}/` : '';
  const markdown = skill.skillMarkdown ? stripFrontmatter(skill.skillMarkdown).body : '';
  const rendered = markdown
    ? toHtml(
        demoteHeadings(
          markdownToHast(markdown, {
            linkBase: `${repo}/blob/${encodeURIComponent(ref)}/${dir}`,
            linkRoot: `${repo}/`,
          }),
        ),
      )
    : '<p class="muted">No SKILL.md content.</p>';
  const verifiedCommit =
    skill.verificationState === 'VERIFIED' ? skill.currentVersion?.commitSha : undefined;

  const install = AGENTS.filter((agent) => skill.agents.includes(agent.id))
    .map((agent) => {
      const plan = buildInstallPlan({
        owner: skill.owner,
        repo: skill.repo,
        skillPath: skill.path,
        skill: {
          name: skill.name,
          hasDescription: skill.description.trim().length > 0,
          specValid: skill.specValid,
        },
        agent: agent.id,
        scope: 'project',
        method: 'symlink',
        commitSha: verifiedCommit,
      });
      return plan.ok
        ? `<h3>${esc(agent.label)}</h3><pre><code>${esc(plan.install)}</code></pre><p class="muted">Installs to <code>${esc(plan.targetDir)}</code>.${plan.pinned ? ' Pinned to the verified commit.' : ''}</p>`
        : `<h3>${esc(agent.label)}</h3><p class="muted">${esc(plan.reason)}</p>`;
    })
    .join('\n');

  const report = skill.report;
  const findings =
    report && report.scan.status === 'COMPLETE'
      ? report.findings.length === 0
        ? '<p>No findings were recorded.</p>'
        : `<ul class="list">${report.findings
            .map(
              (f) =>
                `<li class="row"><strong>${esc(f.severity.toUpperCase())}</strong> <code>${esc(f.rule_id)}</code>${f.file_path ? ` <span class="mono">${esc(f.file_path)}${f.line_start ? `:${esc(f.line_start)}` : ''}</span>` : ''}${f.status !== 'open' ? ` <span class="muted">(reviewed: ${esc(f.status.replace('_', ' '))})</span>` : ''}<p>${esc(f.explanation)}</p>${f.excerpt ? `<pre><code>${esc(f.excerpt)}</code></pre>` : ''}</li>`,
            )
            .join('')}</ul>`
      : '<p class="muted">The current version has no completed assessment, so it is shown as Unverified. That is the absence of an assessment, not a finding.</p>';

  const issue = (template: string) =>
    `${repositoryUrl}/issues/new?template=${template}&title=${encodeURIComponent(skill.slug)}`;
  const body = `<p class="muted mono"><a href="${repo}" rel="noopener noreferrer">${esc(skill.owner)}/${esc(skill.repo)}</a>${skill.path ? ` / ${esc(skill.path)}` : ''}</p>
<h1>${esc(skill.name)} ${badge(skill.verificationState)}</h1>
<p>${esc(skill.description)}</p>
${skill.verificationState === 'FLAGGED' ? '<p class="warn" role="alert">This version has security findings. Read them below before installing.</p>' : ''}
${skill.verificationState === 'UNVERIFIED' ? '<p class="note">This version has not been verified. Review the source before installing.</p>' : ''}
<section class="panel" aria-labelledby="install"><h2 id="install">Install</h2>${install || '<p class="muted">No supported agent is listed for this skill.</p>'}<p class="muted">Needs Node.js 22.20 or later for the skills CLI. Nothing is installed by this site.</p></section>
<section aria-labelledby="readme"><h2 id="readme">SKILL.md</h2><div class="prose">${rendered}</div></section>
<section class="panel" aria-labelledby="security"><h2 id="security">Security assessment</h2>
<p>${badge(skill.verificationState)} ${skill.verification?.note ? esc(skill.verification.note) : ''}</p>
${report ? `<p class="muted">Commit <code>${esc(report.scan.commit_sha.slice(0, 12))}</code>, scanner ${esc(report.scan.scanner_version)}, policy ${esc(report.scan.policy_version)}${skill.verification?.expires_at ? `, verified until ${esc(skill.verification.expires_at.slice(0, 10))}` : ''}.</p>` : ''}
${findings}
<p class="muted">Static analysis of one exact version. It reduces risk and shows evidence; it does not certify that a skill is safe.</p></section>
<section aria-labelledby="files"><h2 id="files">Files</h2><ul>${skill.files.map((f) => `<li class="mono">${esc(f.path)}</li>`).join('')}</ul></section>
<p><a href="${esc(issue('skill_report.yml'))}" rel="noopener noreferrer">Report a problem with this skill</a> · <a href="${esc(issue('false_positive.yml'))}" rel="noopener noreferrer">Appeal a finding</a></p>`;
  return page({ title: skill.name, depth, body, description: skill.description.slice(0, 300) });
}

async function main(): Promise<void> {
  loadRootEnvFile();
  const env = parseEnv();
  const handle = await openDatabase(env.DATABASE_URL);
  const started = performance.now();
  try {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    write('assets/site.css', stylesheet());
    write('assets/search.js', SEARCH_SCRIPT);
    const require = createRequire(import.meta.url);
    // The package does not export its browser build, so locate it from the CommonJS entry.
    const minisearchDist = join(dirname(require.resolve('minisearch')), '..', 'umd', 'index.js');
    copyFileSync(minisearchDist, join(outDir, 'assets/minisearch.js'));

    // All active skills, by quality.
    const items: SkillListItem[] = [];
    for (let pageNumber = 1; ; pageNumber += 1) {
      const result = await listSkills(handle.db, {
        sort: 'recommended',
        page: pageNumber,
        pageSize: 100,
      });
      items.push(...result.items);
      if (pageNumber >= result.pageCount) break;
    }
    const categories = await listCategories(handle.db);

    // Detail pages and per-skill JSON.
    const MiniSearch = (await import('minisearch')).default;
    const search = new MiniSearch({
      fields: ['name', 'description', 'repo', 'categories'],
      storeFields: ['slug', 'name', 'description', 'repo'],
    });
    const documents: Array<Record<string, string>> = [];
    for (const item of items) {
      const skill = await getSkillBySlug(handle.db, item.slug);
      if (!skill) continue;
      write(`${skillPath(skill.slug)}index.html`, detailPage(skill));
      write(
        `api/v1/skills/${skill.id}.json`,
        JSON.stringify({ data: serializeSkillDetail(skill) }),
      );
      write(
        `api/v1/skills/${skill.id}/security.json`,
        JSON.stringify({ data: serializeSecurity(skill) }),
      );
      documents.push({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        description: skill.description.slice(0, 300),
        repo: `${skill.owner}/${skill.repo}`,
        categories: skill.categories.map((c) => c.name).join(' '),
      });
    }
    search.addAll(documents);
    write('search/index.json', JSON.stringify(search));
    write(
      'api/v1/skills.json',
      JSON.stringify({ data: items.map(serializeSkill), generatedAt: generatedAt.toISOString() }),
    );
    write('api/v1/categories.json', JSON.stringify({ data: categories }));

    // Lists.
    const counts = { VERIFIED: 0, UNVERIFIED: 0, FLAGGED: 0 } as Record<string, number>;
    for (const item of items)
      counts[item.verificationState] = (counts[item.verificationState] ?? 0) + 1;
    write(
      'index.html',
      page({
        title: 'Agent skills catalog',
        depth: 0,
        body: `<h1>Agent skills catalog</h1>
<p class="muted">${items.length} skills: ${counts.VERIFIED} verified, ${counts.UNVERIFIED} unverified, ${counts.FLAGGED} flagged. <a href="./search/">Search</a> or browse by <a href="./categories/">category</a>.</p>
<p class="muted">To suggest a repository, <a href="${esc(repositoryUrl)}/issues/new/choose" rel="noopener noreferrer">open an issue</a>.</p>
<ul class="list">${items.map((item) => skillRow(item, 0)).join('\n')}</ul>`,
      }),
    );
    write(
      'categories/index.html',
      page({
        title: 'Categories',
        depth: 1,
        body: `<h1>Categories</h1><ul class="list">${categories
          .filter((c) => c.skillCount > 0)
          .map(
            (c) =>
              `<li class="row"><a href="./${esc(c.slug)}/"><strong>${esc(c.name)}</strong></a> <span class="muted">${c.skillCount}</span>${c.description ? `<p>${esc(c.description)}</p>` : ''}</li>`,
          )
          .join('')}</ul>`,
      }),
    );
    for (const category of categories.filter((c) => c.skillCount > 0)) {
      const inCategory: SkillListItem[] = [];
      for (let pageNumber = 1; ; pageNumber += 1) {
        const result = await listSkills(handle.db, {
          category: category.slug,
          sort: 'recommended',
          page: pageNumber,
          pageSize: 100,
        });
        inCategory.push(...result.items);
        if (pageNumber >= result.pageCount) break;
      }
      write(
        `categories/${category.slug}/index.html`,
        page({
          title: category.name,
          depth: 2,
          body: `<h1>${esc(category.name)}</h1><ul class="list">${inCategory.map((item) => skillRow(item, 2)).join('\n')}</ul>`,
        }),
      );
    }
    write(
      'search/index.html',
      page({
        title: 'Search',
        depth: 1,
        body: `<h1>Search</h1>
<label for="q" class="muted">Search skills by name, description or repository</label><br>
<input id="q" type="search" autocomplete="off" disabled>
<p id="search-status" role="status" aria-live="polite" class="muted">Loading the search index…</p>
<ul id="results" class="list"></ul>
<script src="../assets/minisearch.js"></script>
<script src="../assets/search.js"></script>`,
      }).replace('<html lang="en">', '<html lang="en" data-base="../">'),
    );
    write(
      '404.html',
      page({
        title: 'Not found',
        depth: 0,
        body: '<h1>Page not found</h1><p><a href="/">Back to the catalog</a></p>',
      }),
    );
    write('robots.txt', 'User-agent: *\nAllow: /\n');
    write('.nojekyll', '');

    console.log(
      `Exported ${documents.length} skills and ${categories.length} categories to ${outDir} in ${Math.round(performance.now() - started)} ms.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
