import { describe, test, expect } from 'bun:test';
import {
  LABEL_MIN_OUTCOMES,
  checkLabel,
  ruleLabel,
  harmfulSummary,
  withCheckLabels,
  withRuleLabels,
} from '../../src/core/analytics-labels.js';

// ── checkLabel ──────────────────────────────────────────────────────────────

describe('checkLabel: sample-size gate', () => {
  test('INSUFFICIENT_DATA when sample_size < threshold (the GraphQLVariablesCheck case)', () => {
    // The exact pattern from the 2026-04-30 report: 4 outcomes, all regressed.
    // Pre-gate this would have read "HARMFUL"; post-gate we refuse to label.
    const card = {
      check: 'GraphQLVariablesCheck',
      sample_size: 4,
      resolution_rate: { mean: 0,    lower95: 0,    upper95: 0 },
      mislead_rate:    { mean: 1,    lower95: 0.5,  upper95: 1 },
    };
    expect(checkLabel(card)).toBe('INSUFFICIENT_DATA');
  });

  test('INSUFFICIENT_DATA when sample_size === 0 (no outcomes at all)', () => {
    expect(checkLabel({ sample_size: 0, resolution_rate: 0, mislead_rate: 0 })).toBe('INSUFFICIENT_DATA');
  });

  test('INSUFFICIENT_DATA at threshold-minus-one', () => {
    expect(checkLabel({
      sample_size: LABEL_MIN_OUTCOMES - 1,
      resolution_rate: 1, mislead_rate: 0,
    })).toBe('INSUFFICIENT_DATA');
  });

  test('crosses gate at LABEL_MIN_OUTCOMES — same effectiveness now labelled', () => {
    expect(checkLabel({
      sample_size: LABEL_MIN_OUTCOMES,
      resolution_rate: 0.9, mislead_rate: 0.1,
    })).toBe('GOOD');
  });

  test('falls back to total_outcomes when sample_size missing', () => {
    expect(checkLabel({
      total_outcomes: LABEL_MIN_OUTCOMES,
      resolution_rate: 0.9, mislead_rate: 0.1,
    })).toBe('GOOD');
    expect(checkLabel({
      total_outcomes: LABEL_MIN_OUTCOMES - 1,
      resolution_rate: 0.9, mislead_rate: 0.1,
    })).toBe('INSUFFICIENT_DATA');
  });
});

describe('checkLabel: effectiveness buckets', () => {
  // Once we're above the sample-size gate, the buckets must match the
  // existing dashboard inline logic exactly so legacy reports don't shift.
  const big = LABEL_MIN_OUTCOMES * 10;

  test('GOOD when effectiveness > 0.5', () => {
    expect(checkLabel({ sample_size: big, resolution_rate: 0.9, mislead_rate: 0.1 })).toBe('GOOD');
    expect(checkLabel({ sample_size: big, resolution_rate: 0.7, mislead_rate: 0.0 })).toBe('GOOD');
  });

  test('OK when 0.15 < effectiveness ≤ 0.5', () => {
    expect(checkLabel({ sample_size: big, resolution_rate: 0.6, mislead_rate: 0.1 })).toBe('OK');
    expect(checkLabel({ sample_size: big, resolution_rate: 0.5, mislead_rate: 0.0 })).toBe('OK');
  });

  test('LOW when 0 ≤ effectiveness ≤ 0.15', () => {
    expect(checkLabel({ sample_size: big, resolution_rate: 0.2, mislead_rate: 0.1 })).toBe('LOW');
    expect(checkLabel({ sample_size: big, resolution_rate: 0.1, mislead_rate: 0.1 })).toBe('LOW');
  });

  test('HARMFUL when effectiveness < 0', () => {
    expect(checkLabel({ sample_size: big, resolution_rate: 0.1, mislead_rate: 0.5 })).toBe('HARMFUL');
    expect(checkLabel({ sample_size: big, resolution_rate: 0.0, mislead_rate: 0.6 })).toBe('HARMFUL');
  });
});

describe('checkLabel: input shape tolerance', () => {
  test('accepts Beta-posterior {mean,...} objects (server-side payload shape)', () => {
    const card = {
      sample_size: 20,
      resolution_rate: { mean: 0.85, lower95: 0.7, upper95: 0.95 },
      mislead_rate:    { mean: 0.05, lower95: 0.0, upper95: 0.15 },
    };
    expect(checkLabel(card)).toBe('GOOD');
  });

  test('accepts bare numbers (legacy / test-shaped payloads)', () => {
    expect(checkLabel({
      sample_size: 20, resolution_rate: 0.85, mislead_rate: 0.05,
    })).toBe('GOOD');
  });

  test('null/undefined card returns INSUFFICIENT_DATA without throwing', () => {
    expect(checkLabel(null)).toBe('INSUFFICIENT_DATA');
    expect(checkLabel(undefined)).toBe('INSUFFICIENT_DATA');
    expect(checkLabel('not-an-object')).toBe('INSUFFICIENT_DATA');
  });

  test('NaN sample_size is treated as zero (not crashed)', () => {
    expect(checkLabel({ sample_size: NaN, resolution_rate: 1, mislead_rate: 0 }))
      .toBe('INSUFFICIENT_DATA');
  });
});

// ── ruleLabel ───────────────────────────────────────────────────────────────

describe('ruleLabel: precedence', () => {
  test('UNMATCHED wins regardless of sample size', () => {
    // Coverage gap is actionable on its own — one emit on a rule-less
    // check still tells operators "write a rule for this". Sample-size
    // gate must NOT mask it.
    expect(ruleLabel({ unmatched: true, total_outcomes: 1, effectiveness: 0 }))
      .toBe('UNMATCHED');
    expect(ruleLabel({ unmatched: true, total_outcomes: 100, effectiveness: 0.9 }))
      .toBe('UNMATCHED');
  });

  test('INSUFFICIENT_DATA when matched rule has < threshold outcomes', () => {
    // The exact pattern from the 04-30 report: several AT-RISK rules with
    // total_outcomes between 1 and 4. They become INSUFFICIENT_DATA.
    expect(ruleLabel({ unmatched: false, total_outcomes: 4, effectiveness: -1 }))
      .toBe('INSUFFICIENT_DATA');
    expect(ruleLabel({ unmatched: false, total_outcomes: 1, effectiveness: 0 }))
      .toBe('INSUFFICIENT_DATA');
  });

  test('AT RISK when effectiveness < 0.15 with enough samples', () => {
    expect(ruleLabel({ unmatched: false, total_outcomes: 20, effectiveness: 0.1 }))
      .toBe('AT RISK');
    expect(ruleLabel({ unmatched: false, total_outcomes: 20, effectiveness: -0.5 }))
      .toBe('AT RISK');
  });

  test('OK when effectiveness >= 0.15 with enough samples', () => {
    expect(ruleLabel({ unmatched: false, total_outcomes: 20, effectiveness: 0.15 }))
      .toBe('OK');
    expect(ruleLabel({ unmatched: false, total_outcomes: 20, effectiveness: 0.9 }))
      .toBe('OK');
  });

  test('null/undefined rule returns INSUFFICIENT_DATA without throwing', () => {
    expect(ruleLabel(null)).toBe('INSUFFICIENT_DATA');
    expect(ruleLabel(undefined)).toBe('INSUFFICIENT_DATA');
  });

  test('NaN effectiveness is INSUFFICIENT_DATA, not OK or AT RISK', () => {
    expect(ruleLabel({ unmatched: false, total_outcomes: 20, effectiveness: NaN }))
      .toBe('INSUFFICIENT_DATA');
  });
});

// ── harmfulSummary ──────────────────────────────────────────────────────────

describe('harmfulSummary', () => {
  test('returns rows whose label is HARMFUL — never single-emit ghosts', () => {
    const cards = [
      // Ghost: 4 emits all regressed. Pre-gate flagged HARMFUL; post-gate filtered.
      { check: 'OldGhost',     sample_size: 4,  resolution_rate: 0,    mislead_rate: 1 },
      // Real: 30 outcomes, true regression-heavy.
      { check: 'RealHarm',     sample_size: 30, resolution_rate: 0.1,  mislead_rate: 0.6 },
      // Healthy: ignored.
      { check: 'Healthy',      sample_size: 30, resolution_rate: 0.9,  mislead_rate: 0.05 },
    ];
    const harmful = harmfulSummary(cards);
    expect(harmful).toHaveLength(1);
    expect(harmful[0].check).toBe('RealHarm');
  });

  test('non-array input returns []', () => {
    expect(harmfulSummary(null)).toEqual([]);
    expect(harmfulSummary(undefined)).toEqual([]);
    expect(harmfulSummary('nope')).toEqual([]);
  });

  test('empty array returns []', () => {
    expect(harmfulSummary([])).toEqual([]);
  });
});

// ── withCheckLabels / withRuleLabels ────────────────────────────────────────

describe('withCheckLabels', () => {
  test('attaches .label without mutating input rows', () => {
    const cards = [
      { check: 'A', sample_size: 30, resolution_rate: 0.9, mislead_rate: 0.05 },
      { check: 'B', sample_size: 2,  resolution_rate: 0,   mislead_rate: 1 },
    ];
    const out = withCheckLabels(cards);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe('GOOD');
    expect(out[1].label).toBe('INSUFFICIENT_DATA');
    // input untouched — no .label leakage
    expect('label' in cards[0]).toBe(false);
    expect('label' in cards[1]).toBe(false);
  });

  test('non-array input returns []', () => {
    expect(withCheckLabels(null)).toEqual([]);
  });
});

describe('withRuleLabels', () => {
  test('attaches .label without mutating input rows', () => {
    const rules = [
      { rule_id: 'X.foo', unmatched: true,  total_outcomes: 1,  effectiveness: 0 },
      { rule_id: 'Y.bar', unmatched: false, total_outcomes: 30, effectiveness: 0.9 },
      { rule_id: 'Z.baz', unmatched: false, total_outcomes: 2,  effectiveness: -1 },
    ];
    const out = withRuleLabels(rules);
    expect(out[0].label).toBe('UNMATCHED');
    expect(out[1].label).toBe('OK');
    expect(out[2].label).toBe('INSUFFICIENT_DATA');
    expect('label' in rules[0]).toBe(false);
  });

  test('non-array input returns []', () => {
    expect(withRuleLabels(undefined)).toEqual([]);
  });
});

// ── threshold export sanity ─────────────────────────────────────────────────

describe('LABEL_MIN_OUTCOMES', () => {
  test('exported as a positive integer ≥ 2', () => {
    expect(typeof LABEL_MIN_OUTCOMES).toBe('number');
    expect(Number.isInteger(LABEL_MIN_OUTCOMES)).toBe(true);
    expect(LABEL_MIN_OUTCOMES).toBeGreaterThanOrEqual(2);
  });
});
