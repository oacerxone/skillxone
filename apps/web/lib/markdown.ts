import type { Element, Root } from 'hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * Renders untrusted Markdown (SKILL.md and other repository files) to a sanitised
 * HTML syntax tree. Defence in depth:
 *
 *  1. Raw HTML in the source is dropped at conversion (no `allowDangerousHtml`).
 *  2. Images become plain links, so the page never loads a resource chosen by a repository.
 *  3. `rehype-sanitize` enforces an element/attribute allowlist and http(s)/mailto links only.
 *  4. Links are rewritten: external ones get `rel` protection, relative ones resolve inside
 *     the source repository or lose their `href`.
 *
 * The tree is turned into React elements by the caller, so no HTML string is ever
 * injected into the page.
 */

const MAX_SOURCE_BYTES = 200_000;

const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => tag !== 'img' && tag !== 'picture' && tag !== 'source',
  ),
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};

export interface MarkdownOptions {
  /**
   * Absolute `https://github.com/...` URL of the directory the document lives in.
   * Relative links are resolved against it and must stay inside `linkRoot`.
   */
  linkBase?: string;
  /** Prefix a resolved relative link must keep, e.g. `https://github.com/owner/repo/`. */
  linkRoot?: string;
}

/** Splits leading YAML frontmatter from the Markdown body. */
export function stripFrontmatter(source: string): { frontmatter: string | null; body: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { frontmatter: null, body: source };
  return { frontmatter: match[1] ?? '', body: source.slice(match[0].length) };
}

function imagesToLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return;
      const src = typeof node.properties.src === 'string' ? node.properties.src : '';
      const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
      node.tagName = 'a';
      node.properties = { href: src };
      node.children = [{ type: 'text', value: alt ? `Image: ${alt}` : 'Image' }];
    });
  };
}

function resolveRelative(href: string, options: MarkdownOptions): string | null {
  if (!options.linkBase || !options.linkRoot) return null;
  if (href.startsWith('#') || href.startsWith('//')) return null;
  try {
    const resolved = new URL(href, options.linkBase);
    // URL normalisation collapses `..`; the result must still be inside the repository.
    return resolved.protocol === 'https:' && resolved.href.startsWith(options.linkRoot)
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

function secureLinks(options: MarkdownOptions) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = typeof node.properties.href === 'string' ? node.properties.href : '';
      const isAbsolute = /^(https?:|mailto:)/i.test(href);
      const finalHref = isAbsolute ? href : resolveRelative(href, options);
      if (!finalHref) {
        node.properties = {};
        return;
      }
      node.properties = { href: finalHref, rel: ['nofollow', 'noopener', 'noreferrer', 'ugc'] };
    });
  };
}

/** Converts untrusted Markdown into a sanitised hast tree. */
export function markdownToHast(source: string, options: MarkdownOptions = {}): Root {
  const bounded = source.length > MAX_SOURCE_BYTES ? source.slice(0, MAX_SOURCE_BYTES) : source;
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(imagesToLinks)
    .use(rehypeSanitize, schema)
    .use(secureLinks, options);
  return processor.runSync(processor.parse(bounded)) as Root;
}
