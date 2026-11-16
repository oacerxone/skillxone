/**
 * Quality scoring (ADR-008).
 *
 * Quality is query-independent and separate from search relevance. It is a weighted sum of
 * signals, each normalised to 0..1, followed by gates. Every signal returns a plain-language
 * explanation, and the per-signal values are stored so a score can always be explained.
 *
 * To add a signal: write a `Signal`, add it to `SIGNALS` with a default weight, and add
 * tests. Weights are data (`RankingWeights`) so an operator can change them without code.
 */

export const WEIGHTS_VERSION = '1';

export interface SignalInput {
  stars: number;
  forks: number;
  /** Stars gained over the trailing 30 days, or null when there is not enough history. */
  starDelta30: number | null;
  /** Stars gained over the trailing 7 days, or null when there is not enough history. */
  starDelta7: number | null;
  /** Distinct days of recorded metrics for the repository. */
  historyDays: number;
  daysSincePush: number | null;
  daysSinceContentChange: number | null;
  archived: boolean;
  bodyLength: number;
  hasExamples: boolean;
  brokenReferences: number;
  specValid: boolean;
  descriptionLength: number;
  hasLicense: boolean;
  verificationState: 'VERIFIED' | 'UNVERIFIED' | 'FLAGGED';
  /** Agents with a declared or verified level, and all supported agents. */
  confirmedAgents: number;
  supportedAgents: number;
  /** Open community reports under review. */
  openReports: number;
}

export interface SignalResult {
  value: number;
  weight: number;
  explanation: string;
}

export interface Signal {
  id: string;
  label: string;
  compute(input: SignalInput): { value: number; explanation: string };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const logScale = (value: number, cap: number) =>
  clamp01(Math.log10(1 + Math.max(0, value)) / Math.log10(1 + cap));
/** 1 at zero days, 0.5 at `halfLife` days, approaching 0 after that. */
const decay = (days: number | null, halfLife: number) =>
  days === null ? 0 : clamp01(0.5 ** (Math.max(0, days) / halfLife));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Minimum days of recorded history before any growth figure is used. */
export const MIN_HISTORY_DAYS = 7;

export const SIGNALS: readonly Signal[] = [
  {
    id: 'popularity',
    label: 'Popularity',
    compute: ({ stars }) => ({
      // Logarithmic, so 50,000 stars is not a thousand times "better" than 50.
      value: logScale(stars, 50_000),
      explanation: `${plural(stars, 'star')} on the source repository.`,
    }),
  },
  {
    id: 'forks',
    label: 'Fork activity',
    compute: ({ forks }) => ({
      value: logScale(forks, 5000),
      explanation: `${plural(forks, 'fork')}.`,
    }),
  },
  {
    id: 'growth',
    label: 'Recent star growth',
    compute: ({ starDelta30, stars, historyDays }) => {
      if (starDelta30 === null || historyDays < MIN_HISTORY_DAYS) {
        return { value: 0, explanation: 'Not enough recorded history to measure growth yet.' };
      }
      // Relative to the square root of the total, so small projects can register growth
      // without large ones winning automatically.
      const value = clamp01(Math.max(0, starDelta30) / (4 * Math.sqrt(stars + 25)));
      return {
        value,
        explanation: `${plural(Math.max(0, starDelta30), 'star')} gained in the last 30 days.`,
      };
    },
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    compute: ({ daysSincePush, archived }) => {
      if (archived) return { value: 0, explanation: 'The repository is archived.' };
      if (daysSincePush === null) return { value: 0, explanation: 'Last push date is unknown.' };
      return {
        value: decay(daysSincePush, 120),
        explanation: `Last push to the repository ${plural(Math.round(daysSincePush), 'day')} ago.`,
      };
    },
  },
  {
    id: 'freshness',
    label: 'Content freshness',
    compute: ({ daysSinceContentChange }) => ({
      value: decay(daysSinceContentChange, 240),
      explanation:
        daysSinceContentChange === null
          ? 'Content change date is unknown.'
          : `Skill content last changed ${plural(Math.round(daysSinceContentChange), 'day')} ago.`,
    }),
  },
  {
    id: 'documentation',
    label: 'Documentation',
    compute: ({ bodyLength, hasExamples, brokenReferences }) => {
      const length =
        bodyLength >= 1500 ? 0.6 : bodyLength >= 400 ? 0.4 : bodyLength >= 100 ? 0.2 : 0;
      const value = clamp01(length + (hasExamples ? 0.3 : 0) + (brokenReferences === 0 ? 0.1 : 0));
      const parts = [
        bodyLength >= 1500
          ? 'Detailed instructions'
          : bodyLength >= 400
            ? 'Moderate instructions'
            : 'Brief instructions',
        hasExamples ? 'with examples' : 'without examples',
      ];
      if (brokenReferences > 0) parts.push(`and ${plural(brokenReferences, 'broken link')}`);
      return { value, explanation: `${parts.join(' ')}.` };
    },
  },
  {
    id: 'metadata',
    label: 'Metadata quality',
    compute: ({ specValid, descriptionLength, hasLicense }) => {
      const description = descriptionLength >= 60 ? 0.3 : descriptionLength >= 20 ? 0.15 : 0;
      const value = clamp01((specValid ? 0.5 : 0) + description + (hasLicense ? 0.2 : 0));
      const parts = [
        specValid
          ? 'Follows the Agent Skills specification'
          : 'Does not fully follow the Agent Skills specification',
        hasLicense ? 'license stated' : 'no license stated',
      ];
      return { value, explanation: `${parts.join('; ')}.` };
    },
  },
  {
    id: 'security',
    label: 'Security assessment',
    compute: ({ verificationState }) =>
      verificationState === 'VERIFIED'
        ? { value: 1, explanation: 'The current version is verified.' }
        : verificationState === 'FLAGGED'
          ? { value: 0, explanation: 'The current version has blocking security findings.' }
          : { value: 0.5, explanation: 'The current version has not been assessed.' },
  },
  {
    id: 'compatibility',
    label: 'Confirmed compatibility',
    compute: ({ confirmedAgents, supportedAgents }) => ({
      value: supportedAgents === 0 ? 0 : clamp01(confirmedAgents / supportedAgents),
      explanation:
        supportedAgents === 0
          ? 'No supported agent is listed.'
          : `Compatibility is declared or verified for ${confirmedAgents} of ${plural(supportedAgents, 'agent')}.`,
    }),
  },
];

export type RankingWeights = Record<string, number>;

/** Lifetime stars contribute at most 18% of the score. */
export const DEFAULT_WEIGHTS: RankingWeights = {
  popularity: 0.18,
  forks: 0.05,
  growth: 0.12,
  maintenance: 0.15,
  freshness: 0.1,
  documentation: 0.12,
  metadata: 0.1,
  security: 0.13,
  compatibility: 0.05,
};

export const FLAGGED_MULTIPLIER = 0.25;
const REPORT_PENALTY = 0.03;
const REPORT_PENALTY_CAP = 0.15;
/** Repositories above this are established, not "rising". */
const RISING_STAR_CEILING = 5000;

export interface RankingResult {
  quality: number;
  trending: number;
  rising: number;
  maintenance: number;
  signals: Record<string, SignalResult>;
  /** Gates applied after the weighted sum, in plain language. */
  adjustments: string[];
  weightsVersion: string;
}

/** Scales weights to sum to 1, ignoring unknown, negative or non-finite entries. */
export function normaliseWeights(weights: RankingWeights): RankingWeights {
  const entries = SIGNALS.map((signal) => {
    const weight = weights[signal.id];
    return [
      signal.id,
      typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 0,
    ] as const;
  });
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return normaliseWeights(DEFAULT_WEIGHTS);
  return Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]));
}

export function computeRanking(
  input: SignalInput,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): RankingResult {
  const normalised = normaliseWeights(weights);
  const signals: Record<string, SignalResult> = {};
  let quality = 0;
  for (const signal of SIGNALS) {
    const { value, explanation } = signal.compute(input);
    const weight = normalised[signal.id] ?? 0;
    signals[signal.id] = { value: clamp01(value), weight, explanation };
    quality += clamp01(value) * weight;
  }

  const adjustments: string[] = [];
  const flagged = input.verificationState === 'FLAGGED';
  if (flagged) {
    quality *= FLAGGED_MULTIPLIER;
    adjustments.push('Score reduced to a quarter because the current version is flagged.');
  }
  if (input.openReports > 0) {
    const penalty = Math.min(REPORT_PENALTY_CAP, input.openReports * REPORT_PENALTY);
    quality -= penalty;
    adjustments.push(`Reduced for ${plural(input.openReports, 'open community report')}.`);
  }
  quality = clamp01(quality);

  // Trend scores come only from recorded history and are zero without it. Flagged skills
  // never trend, however fast their repository grows.
  const enoughHistory = input.historyDays >= MIN_HISTORY_DAYS;
  let trending = 0;
  let rising = 0;
  if (enoughHistory && !flagged && !input.archived) {
    if (input.starDelta7 !== null && input.starDelta7 > 0) {
      trending = input.starDelta7 / Math.sqrt(input.stars + 25);
    }
    if (input.starDelta30 !== null && input.starDelta30 > 0 && input.stars < RISING_STAR_CEILING) {
      const before = Math.max(0, input.stars - input.starDelta30);
      rising = input.starDelta30 / (before + 25);
    }
  }

  return {
    quality,
    trending,
    rising,
    maintenance: signals.maintenance?.value ?? 0,
    signals,
    adjustments,
    weightsVersion: WEIGHTS_VERSION,
  };
}

/** Combines search relevance with quality: quality reorders close matches, never rescues a poor one. */
export function blendRelevance(relevance: number, quality: number): number {
  return relevance * (0.6 + 0.4 * clamp01(quality));
}

/** The strongest contributions to a score, for the "why this ranks" explanation. */
export function topContributions(
  result: Pick<RankingResult, 'signals'>,
  limit = 3,
): Array<{ id: string; label: string; contribution: number; explanation: string }> {
  return SIGNALS.map((signal) => {
    const entry = result.signals[signal.id];
    return {
      id: signal.id,
      label: signal.label,
      contribution: entry ? entry.value * entry.weight : 0,
      explanation: entry?.explanation ?? '',
    };
  })
    .filter((item) => item.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit);
}
