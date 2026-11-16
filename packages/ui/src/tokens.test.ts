import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colorTokens, contrastPairs, contrastRatio, renderTokensCss } from './index';
import type { ThemeName } from './index';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    // #767676 on white is the well-known 4.54:1 AA boundary grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('rejects malformed colours', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow();
  });
});

describe('colour tokens', () => {
  it('defines the same tokens in both themes', () => {
    expect(Object.keys(colorTokens.dark)).toEqual(Object.keys(colorTokens.light));
  });

  for (const theme of Object.keys(colorTokens) as ThemeName[]) {
    describe(`${theme} theme`, () => {
      for (const [fg, bg, min] of contrastPairs) {
        it(`${fg} on ${bg} is at least ${min}:1`, () => {
          const ratio = contrastRatio(colorTokens[theme][fg], colorTokens[theme][bg]);
          expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe('tokens.css', () => {
  it('is in sync with tokens.ts (run `pnpm tokens` after editing)', () => {
    const file = fileURLToPath(new URL('./tokens.css', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(renderTokensCss());
  });
});
