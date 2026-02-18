'use strict';
/**
 * constants.js — Shared DOE constants for the LexiCipher QA pipeline.
 *
 * Extracted from bot.js so they can be imported by both the bot runner
 * and the Jest unit test suite without pulling in Playwright or Node I/O.
 */

/**
 * Voting threshold: penalty difference must exceed this to vote non-neutral.
 * Lower = more non-neutral votes = more likely to trigger significance.
 */
const VOTE_THRESHOLD = 3.0;

/**
 * Penalty weights per factor — how much each factor contributes to reading difficulty.
 * Multiplied by the bot's trait value (0–1) and the factor's coded level (−1/+1).
 */
const PENALTY_WEIGHTS = {
  letterSpacing:  15,  // Crowding axis — wider spacing helps crowding-sensitive readers
  wordSpacing:    12,  // Crowding axis
  lineHeight:     18,  // Saccadic axis — taller line height helps saccadic difficulty
  fontWeight:     10,  // Contrast axis — heavier weight helps contrast-sensitive readers
  fontSize:       14,  // Contrast axis — larger size helps
  paragraphWidth: 16,  // Saccadic axis — narrower (40ch at +1) helps saccadic
  bwgt:            8,  // Crowding axis (negative direction — high BWGT = harder)
};

/**
 * Which cognitive trait governs each factor, and whether the high level helps (+1) or hurts (−1).
 */
const FACTOR_TRAIT_MAP = {
  letterSpacing:  { trait: 'crowding',  direction: +1 },
  wordSpacing:    { trait: 'crowding',  direction: +1 },
  lineHeight:     { trait: 'saccadic',  direction: +1 },
  fontWeight:     { trait: 'contrast',  direction: +1 },
  fontSize:       { trait: 'contrast',  direction: +1 },
  paragraphWidth: { trait: 'saccadic',  direction: +1 },
  bwgt:           { trait: 'crowding',  direction: -1 },  // High BWGT = MORE visual weight = harder
};

module.exports = { VOTE_THRESHOLD, PENALTY_WEIGHTS, FACTOR_TRAIT_MAP };
