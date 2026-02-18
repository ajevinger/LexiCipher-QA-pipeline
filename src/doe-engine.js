'use strict';
/**
 * doe-engine.js — Pure DOE math functions for the LexiCipher QA pipeline.
 *
 * All functions here are pure (no I/O, no browser, no env vars).
 * Extracted from bot.js so they can be unit-tested with Jest independently
 * of Playwright and the bot runner.
 *
 * Imported by:
 *   - bot.js (runtime)
 *   - tests/unit/doe-engine.test.js (Jest)
 */

const crypto = require('crypto');
const { VOTE_THRESHOLD, PENALTY_WEIGHTS, FACTOR_TRAIT_MAP } = require('./constants');

// ============================================================
// GAUSSIAN NOISE
// ============================================================

/**
 * Box-Muller transform for Gaussian random number generation.
 * Returns a normally distributed value with given mean and stdDev.
 *
 * @param {number} mean
 * @param {number} stdDev
 * @returns {number}
 */
function gaussianRandom(mean = 0, stdDev = 1) {
  let u1 = Math.random();
  let u2 = Math.random();
  while (u1 === 0) u1 = Math.random(); // Avoid log(0)
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// ============================================================
// PENALTY CALCULATION
// ============================================================

/**
 * Calculate how "difficult" a text sample is for a given cognitive profile.
 *
 * Uses the coded factor levels (−1/+1) from the DOE design matrix, NOT raw CSS.
 * This aligns exactly with how LexiCipher calculates effects:
 *   effect = 2 × Σ(level × rating) / n
 *
 * The penalty is a weighted sum:
 *   penalty = Σ −(factorLevel × weight × traitValue × direction)
 *
 * A LOWER penalty means the sample is EASIER to read for this bot.
 *
 * @param {Object} factorLevels - e.g. { letterSpacing: 1, wordSpacing: -1, ... }
 * @param {Object} traits       - e.g. { crowding: 0.9, saccadic: 0.5, contrast: 0.3 }
 * @returns {number} Penalty score (lower = easier to read)
 */
function calculatePenalty(factorLevels, traits) {
  let penalty = 0;

  for (const [factor, config] of Object.entries(FACTOR_TRAIT_MAP)) {
    const level      = factorLevels[factor] ?? 0;   // −1 or +1 (0 if missing)
    const weight     = PENALTY_WEIGHTS[factor] ?? 0;
    const traitValue = traits[config.trait]   ?? 0; // 0.0 to 1.0
    const direction  = config.direction;             // +1 or −1

    // High level + positive direction → negative contribution to penalty (easier)
    penalty -= level * weight * traitValue * direction;
  }

  return penalty;
}

/**
 * The reference (baseline) penalty is always 0.
 * Baseline CSS is fixed neutral — all voting is relative to it.
 *
 * @returns {number} 0
 */
function calculateReferencePenalty() {
  return 0;
}

// ============================================================
// VOTE DECISION
// ============================================================

/**
 * Decide the vote: −1 (Worse), 0 (Same), or +1 (Better).
 *
 * If the test sample has LOWER penalty than reference (easier to read),
 * the bot votes "Better" (+1). Gaussian noise simulates human inconsistency.
 *
 * @param {number} testPenalty       - Penalty of the test sample
 * @param {number} referencePenalty  - Penalty of the baseline (always 0)
 * @param {number} attentionTrait    - V_ATTENTION (0–1); higher = less noise
 * @returns {-1|0|1}
 */
function decideVote(testPenalty, referencePenalty, attentionTrait = 0.5) {
  const stdDev = (1.0 - attentionTrait) * 10;
  const noise  = gaussianRandom(0, stdDev);
  const diff   = testPenalty - referencePenalty + noise;

  if (diff < -VOTE_THRESHOLD) return  1;  // Test is easier → "Better"
  if (diff >  VOTE_THRESHOLD) return -1;  // Test is harder → "Worse"
  return 0;                                // No meaningful difference → "Same"
}

// ============================================================
// DOE MATRIX HASHING
// ============================================================

/**
 * Compute a short SHA-256 hash of the DOE design matrix.
 * Returns the first 12 hex characters — enough to detect any structural change.
 * If the matrix changes (different factors, levels, or run count), the hash changes.
 *
 * @param {Array<Object>|null} doeMatrix
 * @returns {string|null}
 */
function hashDoeMatrix(doeMatrix) {
  if (!doeMatrix) return null;
  const sortedKeys = Object.keys(doeMatrix[0] || {}).sort();
  const canonical  = JSON.stringify(doeMatrix, sortedKeys);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

module.exports = {
  gaussianRandom,
  calculatePenalty,
  calculateReferencePenalty,
  decideVote,
  hashDoeMatrix,
};
