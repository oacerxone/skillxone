import { toHtml } from 'hast-util-to-html';
import { describe, expect, it } from 'vitest';
import { markdownToHast, stripFrontmatter } from './markdown';

const render = (md: string, options = {}) => toHtml(markdownToHast(md, options));
const GITHUB = {
  linkBase: 'https://github.com/o/r/blob/abc/skills/x/',
  linkRoot: 'https://github.com/o/r/',
};

describe('markdown sanitiser', () => {
  it('renders ordinary Markdown', () => {
    const html = render('# Title\n\nSome **bold** text and `code`.\n\n- a\n- b\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
  });

  it('renders GFM tables', () => {
    expect(render('| a | b |\n| - | - |\n| 1 | 2 |\n')).toContain('<table>');
  });

  it('drops script tags and their content markers', () => {
    const html = render('Hello\n\n<script>alert(1)</script>\n\nWorld');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('alert(1)');
  });

  it('drops raw HTML with event handlers', () => {
    const html = render('<div onclick="steal()">x</div>\n\n<img src=x onerror="steal()">');
    expect(html).not.toMatch(/onclick|onerror/i);
    expect(html).not.toMatch(/<div|<img/i);
  });

  it('drops iframes, objects, forms and style blocks', () => {
    const html = render(
      '<iframe src="https://evil.example"></iframe>\n\n<object data="x"></object>\n\n<form action="/x"><input></form>\n\n<style>body{display:none}</style>',
    );
    expect(html).not.toMatch(/<iframe|<object|<form|<input|<style/i);
  });

  it('removes javascript:, data: and vbscript: links', () => {
    const html = render(
      '[a](javascript:alert(1)) [b](data:text/html,<script>1</script>) [c](vbscript:x) [d](JaVaScRiPt:alert(1))',
    );
    expect(html).not.toMatch(/javascript:|data:|vbscript:/i);
    expect(html).not.toContain('href');
  });

  it('never emits an image element; images become protected links', () => {
    const html = render('![logo](https://tracker.example/pixel.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('href="https://tracker.example/pixel.png"');
    expect(html).toContain('Image: logo');
  });

  it('drops images with unsafe sources entirely', () => {
    const html = render('![x](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain('href');
  });

  it('adds rel protection to external links', () => {
    const html = render('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="nofollow noopener noreferrer ugc"');
  });

  it('resolves relative links inside the repository', () => {
    const html = render('[guide](references/guide.md)', GITHUB);
    expect(html).toContain('href="https://github.com/o/r/blob/abc/skills/x/references/guide.md"');
  });

  it('refuses relative links that escape the repository or change host', () => {
    expect(render('[x](../../../../../../other/repo)', GITHUB)).not.toContain('href');
    expect(render('[x](//evil.example/path)', GITHUB)).not.toContain('href');
    expect(render('[x](/\\evil.example)', GITHUB)).not.toContain('evil.example"');
  });

  it('removes relative links when no base is known', () => {
    expect(render('[guide](references/guide.md)')).not.toContain('href');
  });

  it('keeps code block content as text', () => {
    const html = render('```html\n<script>alert(1)</script>\n```');
    expect(html).toContain('&#x3C;script>');
    expect(html).not.toMatch(/<script>/);
  });

  it('strips class and style attributes that could restyle the page', () => {
    const html = render('<p style="position:fixed" class="fixed inset-0">x</p>\n\ntext');
    expect(html).not.toMatch(/style=|inset-0/);
  });

  it('bounds very large documents', () => {
    const html = render(`${'a'.repeat(300_000)}`);
    expect(html.length).toBeLessThan(210_000);
  });
});

describe('stripFrontmatter', () => {
  it('separates YAML frontmatter from the body', () => {
    expect(stripFrontmatter('---\nname: x\n---\n# Body\n')).toEqual({
      frontmatter: 'name: x',
      body: '# Body\n',
    });
  });

  it('leaves documents without frontmatter untouched', () => {
    expect(stripFrontmatter('# Body\n\n---\n\ntext')).toEqual({
      frontmatter: null,
      body: '# Body\n\n---\n\ntext',
    });
  });

  it('handles CRLF line endings', () => {
    expect(stripFrontmatter('---\r\nname: x\r\n---\r\nBody').body).toBe('Body');
  });
});
