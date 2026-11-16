import { colorTokens, fontTokens, radiusTokens } from './tokens';
import type { ThemeName } from './tokens';

const declarations = (theme: ThemeName, indent: string) =>
  Object.entries(colorTokens[theme])
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');

/**
 * Renders the tokens as CSS custom properties.
 * Light is the default. Dark applies only when the user has chosen it
 * (`<html data-theme="dark">`), as the design system specifies.
 */
export function renderTokensCss(): string {
  return `/* GENERATED from packages/ui/src/tokens.ts by \`pnpm tokens\`. Do not edit. */
:root {
  color-scheme: light;
${declarations('light', '  ')}
  --ff-sans: ${fontTokens.sans};
  --ff-mono: ${fontTokens.mono};
  --rad-sm: ${radiusTokens.sm};
  --rad-md: ${radiusTokens.md};
  --rad-lg: ${radiusTokens.lg};
}

:root[data-theme='dark'] {
  color-scheme: dark;
${declarations('dark', '  ')}
}
`;
}
