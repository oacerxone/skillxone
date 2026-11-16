import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  SIGNALS,
  blendRelevance,
  computeRanking,
  normaliseWeights,
  topContributions,
} from './index';
import type { SignalInput } from './index';

const base: SignalInput = {
  stars: 500,
  forks: 40,
  starDelta30: 30,
  starDelta7: 8,
  historyDays: 30,
  daysSincePush: 10,
  daysSinceContentChange: 20,
  archived: false,
  bodyLength: 2000,
  hasExamples: true,
  brokenReferences: 0,
  specValid: true,
  descriptionLength: 120,
  hasLicense: true,
  verificationState: 'VERIFIED',
  confirmedAgents: 1,
  supportedAgents: 2,
  openReports: 0,
};
const rank = (overrides: Partial<SignalInput> = {}) => computeRanking({ ...base, ...overrides });

describe('weights', () => {
  it('has a weight for every signal and sums to 1', () => {
    expect(Object.keys(DEFAULT_WEIGHTS).sort()).toEqual(SIGNALS.map((s) => s.id).sort());
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('keeps lifetime stars from dominating', () => {
    expect(DEFAULT_WEIGHTS.popularity).toBeLessThanOrEqual(0.2);
  });

  it('normalises operator-supplied weights and ignores junk', () => {
    const weights = normaliseWeights({
      popularity: 2,
      security: 2,
      bogus: 99,
      forks: -1,
      growth: Number.NaN,
    });
    expect(weights.popularity).toBeCloseTo(0.5);
    expect(weights.security).toBeCloseTo(0.5);
    expect(weights.forks).toBe(0);
    expect(weights).not.toHaveProperty('bogus');
    expect(normaliseWeights({})).toEqual(normaliseWeights(DEFAULT_WEIGHTS));
  });
});

describe('quality score', () => {
  it('stays within 0..1 for extreme inputs', () => {
    const high = rank({
      stars: 10_000_000,
      forks: 1_000_000,
      starDelta30: 1_000_000,
      daysSincePush: 0,
      daysSinceContentChange: 0,
      confirmedAgents: 2,
    });
    const low = rank({
      stars: 0,
      forks: 0,
      starDelta30: -50,
      daysSincePush: 5000,
      daysSinceContentChange: 5000,
      bodyLength: 0,
      hasExamples: false,
      specValid: false,
      descriptionLength: 0,
      hasLicense: false,
      verificationState: 'FLAGGED',
      confirmedAgents: 0,
      supportedAgents: 0,
      openReports: 50,
    });
    expect(high.quality).toBeLessThanOrEqual(1);
    expect(high.quality).toBeGreaterThan(0.9);
    expect(low.quality).toBe(0);
    for (const signal of Object.values(high.signals)) {
      expect(signal.value).toBeGreaterThanOrEqual(0);
      expect(signal.value).toBeLessThanOrEqual(1);
    }
  });

  it('scales popularity logarithmically', () => {
    const p = (stars: number) => rank({ stars }).signals.popularity!.value;
    expect(p(0)).toBe(0);
    expect(p(100_000)).toBe(1);
    // Ten times the stars adds the same step, not ten times the score.
    expect(p(1000) - p(100)).toBeCloseTo(p(10_000) - p(1000), 1);
  });

  it('ranks a flagged, very popular skill below a verified, modest one', () => {
    const risky = rank({ stars: 200_000, forks: 20_000, verificationState: 'FLAGGED' });
    const safe = rank({ stars: 300, forks: 20, verificationState: 'VERIFIED' });
    expect(risky.quality).toBeLessThan(safe.quality);
    expect(risky.adjustments[0]).toContain('flagged');
    // With equal search relevance the safer skill still comes first.
    expect(blendRelevance(5, risky.quality)).toBeLessThan(blendRelevance(5, safe.quality));
  });

  it('orders verification states: verified > unverified > flagged', () => {
    const scores = (['VERIFIED', 'UNVERIFIED', 'FLAGGED'] as const).map(
      (state) => rank({ verificationState: state }).quality,
    );
    expect(scores[0]).toBeGreaterThan(scores[1]!);
    expect(scores[1]).toBeGreaterThan(scores[2]!);
  });

  it('gives an archived repository no maintenance credit', () => {
    expect(rank({ archived: true }).signals.maintenance).toMatchObject({
      value: 0,
      explanation: 'The repository is archived.',
    });
    expect(rank({ daysSincePush: 0 }).maintenance).toBe(1);
    expect(rank({ daysSincePush: 120 }).maintenance).toBeCloseTo(0.5);
  });

  it('subtracts for open community reports, up to a cap', () => {
    const clean = rank().quality;
    expect(rank({ openReports: 1 }).quality).toBeCloseTo(clean - 0.03);
    expect(rank({ openReports: 100 }).quality).toBeCloseTo(clean - 0.15);
  });

  it('rewards documentation and metadata quality', () => {
    expect(rank().quality).toBeGreaterThan(
      rank({ bodyLength: 50, hasExamples: false, brokenReferences: 3 }).quality,
    );
    expect(rank().quality).toBeGreaterThan(
      rank({ specValid: false, hasLicense: false, descriptionLength: 5 }).quality,
    );
  });
});

describe('trend scores use recorded history only', () => {
  it('are zero without enough history, whatever the star count', () => {
    const result = rank({ historyDays: 3, starDelta7: 5000, starDelta30: 20_000 });
    expect(result.trending).toBe(0);
    expect(result.rising).toBe(0);
    expect(result.signals.growth).toMatchObject({ value: 0 });
    expect(result.signals.growth!.explanation).toContain('Not enough recorded history');
  });

  it('are zero when deltas are unknown', () => {
    const result = rank({ starDelta7: null, starDelta30: null });
    expect(result.trending).toBe(0);
    expect(result.rising).toBe(0);
  });

  it('never let a flagged or archived skill trend', () => {
    expect(rank({ verificationState: 'FLAGGED', starDelta7: 900 }).trending).toBe(0);
    expect(rank({ archived: true, starDelta7: 900 }).trending).toBe(0);
  });

  it('favour growth relative to size', () => {
    const small = rank({ stars: 200, starDelta7: 60 });
    const large = rank({ stars: 100_000, starDelta7: 60 });
    expect(small.trending).toBeGreaterThan(large.trending);
  });

  it('limit "rising" to repositories that are not already large', () => {
    expect(rank({ stars: 800, starDelta30: 400 }).rising).toBeGreaterThan(0);
    expect(rank({ stars: 80_000, starDelta30: 4000 }).rising).toBe(0);
  });

  it('ignore star losses', () => {
    expect(rank({ starDelta7: -40, starDelta30: -100 })).toMatchObject({ trending: 0, rising: 0 });
  });
});

describe('explanations', () => {
  it('lists the strongest contributions in plain language', () => {
    const top = topContributions(rank(), 3);
    expect(top).toHaveLength(3);
    expect(top[0]!.contribution).toBeGreaterThanOrEqual(top[1]!.contribution);
    for (const item of top) {
      expect(item.label).toBeTruthy();
      expect(item.explanation).toMatch(/\.$/);
    }
  });

  it('explains every signal', () => {
    for (const signal of Object.values(rank().signals))
      expect(signal.explanation.length).toBeGreaterThan(5);
  });
});
