'use strict';
/**
 * doe-engine.test.js — Jest unit tests for the LexiCipher DOE math engine.
 *
 * Tests the pure functions in src/doe-engine.js to ensure font parameter
 * calculations are accurate and the voting logic is deterministic.
 *
 * Run: npm test
 */

const {
  calculatePenalty,
  calculateReferencePenalty,
  decideVote,
  hashDoeMatrix,
  gaussianRandom,
} = require('../../src/doe-engine');

const { PENALTY_WEIGHTS, FACTOR_TRAIT_MAP, VOTE_THRESHOLD } = require('../../src/constants');

// ============================================================
// calculatePenalty
// ============================================================

describe('calculatePenalty', () => {
  const ALL_HIGH = {
    letterSpacing: 1,
    wordSpacing: 1,
    lineHeight: 1,
    fontWeight: 1,
    fontSize: 1,
    paragraphWidth: 1,
    bwgt: 1,
  };

  const ALL_LOW = {
    letterSpacing: -1,
    wordSpacing: -1,
    lineHeight: -1,
    fontWeight: -1,
    fontSize: -1,
    paragraphWidth: -1,
    bwgt: -1,
  };

  test('all factors HIGH with high-crowding bot → large negative penalty (easier to read)', () => {
    const traits = { crowding: 1.0, saccadic: 1.0, contrast: 1.0 };
    const penalty = calculatePenalty(ALL_HIGH, traits);
    // All +1 direction factors reduce penalty; bwgt direction=-1 increases it
    // Net: -(1*15*1*1) -(1*12*1*1) -(1*18*1*1) -(1*10*1*1) -(1*14*1*1) -(1*16*1*1) -(1*14*1*-1)
    //    = -15 -12 -18 -10 -14 -16 +14 = -71
    // (bwgt weight raised from 8→14 on feature/bwgt-isolation-test branch)
    expect(penalty).toBe(-71);
  });

  test('all factors LOW with high-crowding bot → large positive penalty (harder to read)', () => {
    const traits = { crowding: 1.0, saccadic: 1.0, contrast: 1.0 };
    const penalty = calculatePenalty(ALL_LOW, traits);
    // All -1 levels flip the signs: +15 +12 +18 +10 +14 +16 -14 = +71
    // (bwgt weight raised from 8→14 on feature/bwgt-isolation-test branch)
    expect(penalty).toBe(71);
  });

  test('zero traits → penalty is always 0 regardless of factor levels', () => {
    const traits = { crowding: 0, saccadic: 0, contrast: 0 };
    expect(calculatePenalty(ALL_HIGH, traits)).toBe(0);
    expect(calculatePenalty(ALL_LOW, traits)).toBe(0);
  });

  test('bwgt direction is negative — high bwgt INCREASES penalty for crowding-sensitive bot', () => {
    const traits = { crowding: 1.0, saccadic: 0, contrast: 0 };
    // Only crowding factors matter: letterSpacing(+1), wordSpacing(+1), bwgt(-1)
    // All HIGH: -(1*15*1*1) -(1*12*1*1) -(1*14*1*-1) = -15 -12 +14 = -13
    // (bwgt weight raised from 8→14 on feature/bwgt-isolation-test branch)
    const penaltyHigh = calculatePenalty(ALL_HIGH, traits);
    // All LOW: -(-1*15*1*1) -(-1*12*1*1) -(-1*14*1*-1) = +15 +12 -14 = +13
    const penaltyLow = calculatePenalty(ALL_LOW, traits);
    expect(penaltyHigh).toBe(-13);
    expect(penaltyLow).toBe(13);
  });

  test('only saccadic factors matter when crowding=0 and contrast=0', () => {
    const traits = { crowding: 0, saccadic: 1.0, contrast: 0 };
    // Saccadic factors: lineHeight(+1, w=18), paragraphWidth(+1, w=16)
    // ALL_HIGH: -(1*18*1*1) -(1*16*1*1) = -34
    expect(calculatePenalty(ALL_HIGH, traits)).toBe(-34);
    // ALL_LOW: -(-1*18*1*1) -(-1*16*1*1) = +34
    expect(calculatePenalty(ALL_LOW, traits)).toBe(34);
  });

  test('only contrast factors matter when crowding=0 and saccadic=0', () => {
    const traits = { crowding: 0, saccadic: 0, contrast: 1.0 };
    // Contrast factors: fontWeight(+1, w=10), fontSize(+1, w=14)
    // ALL_HIGH: -(1*10*1*1) -(1*14*1*1) = -24
    expect(calculatePenalty(ALL_HIGH, traits)).toBe(-24);
    expect(calculatePenalty(ALL_LOW, traits)).toBe(24);
  });

  test('missing factor levels default to 0 (no contribution)', () => {
    const traits = { crowding: 1.0, saccadic: 1.0, contrast: 1.0 };
    const penalty = calculatePenalty({}, traits);
    expect(penalty).toBe(0);
  });

  test('partial trait values produce proportional penalties', () => {
    const traits = { crowding: 0.5, saccadic: 0, contrast: 0 };
    // letterSpacing only: -(1*15*0.5*1) = -7.5
    const penalty = calculatePenalty({ letterSpacing: 1 }, traits);
    expect(penalty).toBeCloseTo(-7.5);
  });

  test('penalty is symmetric: high vs low levels produce equal and opposite values', () => {
    const traits = { crowding: 0.7, saccadic: 0.3, contrast: 0.6 };
    const penaltyHigh = calculatePenalty(ALL_HIGH, traits);
    const penaltyLow  = calculatePenalty(ALL_LOW, traits);
    expect(penaltyHigh).toBeCloseTo(-penaltyLow);
  });
});

// ============================================================
// calculateReferencePenalty
// ============================================================

describe('calculateReferencePenalty', () => {
  test('always returns 0 (baseline is fixed neutral)', () => {
    expect(calculateReferencePenalty()).toBe(0);
  });
});

// ============================================================
// decideVote
// ============================================================

describe('decideVote', () => {
  // Use attention=1.0 to eliminate noise (stdDev = 0)
  const NO_NOISE_ATTENTION = 1.0;

  test('large negative diff (test much easier) → returns 1 (Better)', () => {
    // testPenalty = -50, ref = 0 → diff = -50 → well below -VOTE_THRESHOLD
    const vote = decideVote(-50, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(1);
  });

  test('large positive diff (test much harder) → returns -1 (Worse)', () => {
    // testPenalty = +50, ref = 0 → diff = +50 → well above +VOTE_THRESHOLD
    const vote = decideVote(50, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(-1);
  });

  test('zero diff with no noise → returns 0 (Same)', () => {
    const vote = decideVote(0, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(0);
  });

  test('diff exactly at -VOTE_THRESHOLD boundary → returns 0 (not Better)', () => {
    // diff = -VOTE_THRESHOLD is NOT < -VOTE_THRESHOLD, so should be Same
    // We can't control noise perfectly, but with attention=1 stdDev=0 → noise=0
    // diff = -3.0 is NOT < -3.0 → Same
    const vote = decideVote(-VOTE_THRESHOLD, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(0);
  });

  test('diff exactly at +VOTE_THRESHOLD boundary → returns 0 (not Worse)', () => {
    const vote = decideVote(VOTE_THRESHOLD, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(0);
  });

  test('diff just below -VOTE_THRESHOLD → returns 1 (Better)', () => {
    const vote = decideVote(-(VOTE_THRESHOLD + 0.001), 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(1);
  });

  test('diff just above +VOTE_THRESHOLD → returns -1 (Worse)', () => {
    const vote = decideVote(VOTE_THRESHOLD + 0.001, 0, NO_NOISE_ATTENTION);
    expect(vote).toBe(-1);
  });

  test('with low attention (high noise), vote distribution is non-deterministic', () => {
    // Run 200 trials with attention=0 (max noise, stdDev=10)
    // Expect all three vote values to appear
    const votes = new Set();
    for (let i = 0; i < 200; i++) {
      votes.add(decideVote(0, 0, 0));
    }
    // With stdDev=10 and threshold=3, we expect Better, Same, and Worse to all appear
    expect(votes.size).toBeGreaterThan(1);
  });
});

// ============================================================
// hashDoeMatrix
// ============================================================

describe('hashDoeMatrix', () => {
  const SAMPLE_MATRIX = [
    { runNumber: 1, parameters: { letterSpacing: 1, wordSpacing: -1, lineHeight: 1, fontWeight: -1, fontSize: 1, paragraphWidth: -1, bwgt: 1 } },
    { runNumber: 2, parameters: { letterSpacing: -1, wordSpacing: 1, lineHeight: -1, fontWeight: 1, fontSize: -1, paragraphWidth: 1, bwgt: -1 } },
  ];

  test('returns a 12-character hex string', () => {
    const hash = hashDoeMatrix(SAMPLE_MATRIX);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test('same matrix produces identical hash (deterministic)', () => {
    const hash1 = hashDoeMatrix(SAMPLE_MATRIX);
    const hash2 = hashDoeMatrix(SAMPLE_MATRIX);
    expect(hash1).toBe(hash2);
  });

  test('different matrix produces different hash', () => {
    const altMatrix = [
      { runNumber: 1, parameters: { letterSpacing: -1, wordSpacing: 1, lineHeight: -1, fontWeight: 1, fontSize: -1, paragraphWidth: 1, bwgt: -1 } },
    ];
    const hash1 = hashDoeMatrix(SAMPLE_MATRIX);
    const hash2 = hashDoeMatrix(altMatrix);
    expect(hash1).not.toBe(hash2);
  });

  test('null input returns null', () => {
    expect(hashDoeMatrix(null)).toBeNull();
  });

  test('empty array returns a valid hash (not null)', () => {
    const hash = hashDoeMatrix([]);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test('matrix with swapped run order produces different hash', () => {
    const reversed = [...SAMPLE_MATRIX].reverse();
    const hash1 = hashDoeMatrix(SAMPLE_MATRIX);
    const hash2 = hashDoeMatrix(reversed);
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================
// gaussianRandom
// ============================================================

describe('gaussianRandom', () => {
  test('returns a number', () => {
    expect(typeof gaussianRandom()).toBe('number');
  });

  test('mean ≈ 0 and stdDev ≈ 1 over 2000 samples (within 3σ of expected)', () => {
    const N = 2000;
    const samples = Array.from({ length: N }, () => gaussianRandom(0, 1));
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / N;
    const stdDev = Math.sqrt(variance);

    // Mean should be within ±0.15 of 0 (very conservative for N=2000)
    expect(Math.abs(mean)).toBeLessThan(0.15);
    // StdDev should be within ±0.15 of 1
    expect(Math.abs(stdDev - 1)).toBeLessThan(0.15);
  });

  test('custom mean and stdDev are respected', () => {
    const N = 2000;
    const targetMean = 5;
    const targetStd  = 2;
    const samples = Array.from({ length: N }, () => gaussianRandom(targetMean, targetStd));
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    expect(Math.abs(mean - targetMean)).toBeLessThan(0.3);
  });

  test('stdDev=0 always returns the mean', () => {
    // Box-Muller with stdDev=0: z0 * 0 + mean = mean
    for (let i = 0; i < 20; i++) {
      expect(gaussianRandom(42, 0)).toBe(42);
    }
  });
});

// ============================================================
// Integration: full vote pipeline
// ============================================================

describe('Full DOE vote pipeline integration', () => {
  test('high-crowding bot votes Better for all-high crowding factors', () => {
    const traits = { crowding: 1.0, saccadic: 0, contrast: 0 };
    const factorLevels = { letterSpacing: 1, wordSpacing: 1, bwgt: -1 }; // all crowding factors at best
    const penalty = calculatePenalty(factorLevels, traits);
    const ref = calculateReferencePenalty();
    // penalty = -(1*15*1*1) -(1*12*1*1) -(-1*14*1*-1) = -15 -12 -14 = -41
    // (bwgt weight raised from 8→14 on feature/bwgt-isolation-test branch)
    expect(penalty).toBe(-41);
    // With no noise (attention=1), diff = -41 - 0 = -41 < -3 → Better
    const vote = decideVote(penalty, ref, 1.0);
    expect(vote).toBe(1);
  });

  test('high-crowding bot votes Worse for all-low crowding factors', () => {
    const traits = { crowding: 1.0, saccadic: 0, contrast: 0 };
    const factorLevels = { letterSpacing: -1, wordSpacing: -1, bwgt: 1 }; // all crowding factors at worst
    const penalty = calculatePenalty(factorLevels, traits);
    const ref = calculateReferencePenalty();
    // penalty = -(-1*15*1*1) -(-1*12*1*1) -(1*14*1*-1) = +15 +12 +14 = +41
    // (bwgt weight raised from 8→14 on feature/bwgt-isolation-test branch)
    expect(penalty).toBe(41);
    const vote = decideVote(penalty, ref, 1.0);
    expect(vote).toBe(-1);
  });

  test('zero-trait bot always votes Same (no noise, no penalty)', () => {
    const traits = { crowding: 0, saccadic: 0, contrast: 0 };
    const factorLevels = { letterSpacing: 1, wordSpacing: -1, lineHeight: 1, fontWeight: -1, fontSize: 1, paragraphWidth: -1, bwgt: 1 };
    const penalty = calculatePenalty(factorLevels, traits);
    const ref = calculateReferencePenalty();
    expect(penalty).toBe(0);
    const vote = decideVote(penalty, ref, 1.0);
    expect(vote).toBe(0);
  });
});
