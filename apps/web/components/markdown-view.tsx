import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { markdownToHast } from '@/lib/markdown';
import type { MarkdownOptions } from '@/lib/markdown';

/**
 * Renders untrusted Markdown. The sanitised syntax tree is converted directly to React
 * elements, so repository content is never injected as an HTML string.
 */
export function MarkdownView({ source, options }: { source: string; options?: MarkdownOptions }) {
  const tree = markdownToHast(source, options);
  return (
    <div className="prose-skill">
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        // Code blocks and wide tables scroll sideways; make them reachable by keyboard.
        components: {
          pre: (props) => <pre tabIndex={0} {...props} />,
          table: (props) => <table tabIndex={0} {...props} />,
          // GFM task lists render as disabled checkboxes; give each an accessible name.
          input: (props) => (
            <input {...props} aria-label={props.checked ? 'Completed' : 'Not completed'} />
          ),
        },
      })}
    </div>
  );
}
