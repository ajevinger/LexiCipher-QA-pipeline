'use strict';
/**
 * constants.test.js — Regression guard for the shared DOE constants.
 *
 * These values underpin every penalty calculation and vote decision in the
 * pipeline.  Changing them silently would shift the statistical model without
 * any failing tests — this file makes that impossible.
 *
 * Run: npm test
 */

const { VOTE_THRESHOLD, PENALTY_WEIGHTS, FACTOR_TRAIT_MAP } = require('../../src/constants');

// ============================================================
// VOTE_THRESHOLD
// ============================================================

describe('VOTE_THRESHOLD', () => {
  test('is exactly 3.0', () => {
    expect(VOTE_THRESHOLD).toBe(3.0);
  });
});

// ============================================================
// PENALTY_WEIGHTS
// ============================================================

describe('PENALTY_WEIGHTS', () => {
  test('letterSpacing weight is 15 (crowding axis)', () => {
    expect(PENALTY_WEIGHTS.letterSpacing).toBe(15);
  });

  test('wordSpacing weight is 12 (crowding axis)', () => {
    expect(PENALTY_WEIGHTS.wordSpacing).toBe(12);
  });

  test('lineHeight weight is 18 (saccadic axis)', () => {
    expect(PENALTY_WEIGHTS.lineHeight).toBe(18);
  });

  test('fontWeight weight is 10 (contrast axis)', () => {
    expect(PENALTY_WEIGHTS.fontWeight).toBe(10);
  });

  test('fontSize weight is 14 (contrast axis)', () => {
    expect(PENALTY_WEIGHTS.fontSize).toBe(14);
  });

  test('paragraphWidth weight is 16 (saccadic axis)', () => {
    expect(PENALTY_WEIGHTS.paragraphWidth).toBe(16);
  });

  test('bwgt weight is 14 (raised from 8 on feature/bwgt-isolation-test)', () => {
    expect(PENALTY_WEIGHTS.bwgt).toBe(14);
  });

  test('exactly 7 factors are defined', () => {
    expect(Object.keys(PENALTY_WEIGHTS)).toHaveLength(7);
  });

  test('all weights are positive numbers', () => {
    for (const [factor, weight] of Object.entries(PENALTY_WEIGHTS)) {
      expect(typeof weight).toBe('number');
      expect(weight).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// FACTOR_TRAIT_MAP
// ============================================================

describe('FACTOR_TRAIT_MAP', () => {
  const VALID_TRAITS = new Set(['crowding', 'saccadic', 'contrast']);

  test('exactly 7 factors are mapped', () => {
    expect(Object.keys(FACTOR_TRAIT_MAP)).toHaveLength(7);
  });

  test('every factor has a trait ∈ {crowding, saccadic, contrast}', () => {
    for (const [, config] of Object.entries(FACTOR_TRAIT_MAP)) {
      expect([...VALID_TRAITS]).toContain(config.trait);
    }
  });

  test('every factor has direction ∈ {-1, +1}', () => {
    for (const [factor, config] of Object.entries(FACTOR_TRAIT_MAP)) {
      expect([-1, 1]).toContain(config.direction);
    }
  });

  // Axis assignments (document the bwgt remapping from crowding → contrast)
  test('letterSpacing maps to crowding axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.letterSpacing).toEqual({ trait: 'crowding', direction: 1 });
  });

  test('wordSpacing maps to crowding axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.wordSpacing).toEqual({ trait: 'crowding', direction: 1 });
  });

  test('lineHeight maps to saccadic axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.lineHeight).toEqual({ trait: 'saccadic', direction: 1 });
  });

  test('fontWeight maps to contrast axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.fontWeight).toEqual({ trait: 'contrast', direction: 1 });
  });

  test('fontSize maps to contrast axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.fontSize).toEqual({ trait: 'contrast', direction: 1 });
  });

  test('paragraphWidth maps to saccadic axis, direction +1', () => {
    expect(FACTOR_TRAIT_MAP.paragraphWidth).toEqual({ trait: 'saccadic', direction: 1 });
  });

  test('bwgt maps to contrast axis (remapped from crowding), direction -1', () => {
    expect(FACTOR_TRAIT_MAP.bwgt).toEqual({ trait: 'contrast', direction: -1 });
  });
});
