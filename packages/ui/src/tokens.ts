/**
 * Design tokens: the single source of truth for colour, type and spacing.
 * Specification: docs/architecture/design-system.md.
 *
 * `tokens.css` is generated from this file (`pnpm tokens`). A test fails if the two
 * drift apart, and another checks every text/background pair below for WCAG AA contrast.
 */

export const colorTokens = {
  light: {
    bg: '#ffffff',
    'bg-subtle': '#fafafa',
    'bg-muted': '#f3f4f5',
    border: '#e5e6e8',
    'border-strong': '#cfd1d5',
    text: '#111315',
    'text-muted': '#5b616b',
    'text-subtle': '#666c76',
    accent: '#3b49df',
    'accent-fg': '#ffffff',
    focus: '#3b49df',
    'verified-fg': '#12703f',
    'verified-bg': '#e9f6ee',
    'unverified-fg': '#5b616b',
    'unverified-bg': '#f3f4f5',
    'flagged-fg': '#b3261e',
    'flagged-bg': '#fdecea',
    'warning-fg': '#8a5a00',
    'warning-bg': '#fdf3dc',
  },
  dark: {
    bg: '#0b0c0e',
    'bg-subtle': '#111316',
    'bg-muted': '#191c20',
    border: '#24282d',
    'border-strong': '#343940',
    text: '#edeef0',
    'text-muted': '#9aa1ab',
    'text-subtle': '#8a919c',
    accent: '#8b95ff',
    'accent-fg': '#0b0c0e',
    focus: '#a5adff',
    'verified-fg': '#5fd092',
    'verified-bg': '#10241a',
    'unverified-fg': '#9aa1ab',
    'unverified-bg': '#191c20',
    'flagged-fg': '#ff8a80',
    'flagged-bg': '#2a1412',
    'warning-fg': '#f0be5a',
    'warning-bg': '#261d0a',
  },
} as const;

export type ThemeName = keyof typeof colorTokens;
export type ColorToken = keyof (typeof colorTokens)['light'];

/**
 * Foreground/background pairs that appear together in the interface, with the minimum
 * contrast ratio each must meet. 4.5 is WCAG AA for normal text; 3 is the AA minimum
 * for user-interface components and focus indicators.
 */
export const contrastPairs: ReadonlyArray<readonly [fg: ColorToken, bg: ColorToken, min: number]> =
  [
    ['text', 'bg', 4.5],
    ['text', 'bg-subtle', 4.5],
    ['text', 'bg-muted', 4.5],
    ['text-muted', 'bg', 4.5],
    ['text-muted', 'bg-subtle', 4.5],
    ['text-muted', 'bg-muted', 4.5],
    ['text-subtle', 'bg', 4.5],
    ['text-subtle', 'bg-subtle', 4.5],
    ['text-subtle', 'bg-muted', 4.5],
    ['accent', 'bg', 4.5],
    ['accent', 'bg-subtle', 4.5],
    ['accent-fg', 'accent', 4.5],
    ['verified-fg', 'verified-bg', 4.5],
    ['unverified-fg', 'unverified-bg', 4.5],
    ['flagged-fg', 'flagged-bg', 4.5],
    ['warning-fg', 'warning-bg', 4.5],
    ['focus', 'bg', 3],
    ['focus', 'bg-muted', 3],
    ['border-strong', 'bg', 1.3], // decorative separators: informational floor only
  ];

export const fontTokens = {
  sans: "var(--font-geist-sans), system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export const radiusTokens = { sm: '4px', md: '6px', lg: '8px' } as const;

/** Spacing scale in pixels. */
export const spaceTokens = [2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64] as const;
