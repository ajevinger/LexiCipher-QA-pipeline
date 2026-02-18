/**
 * LexiCipher Bot — Deterministic Simulated Reader
 *
 * Navigates LexiCipher.org's font optimization test, simulating a human reader
 * with specific cognitive traits. Uses ONLY deterministic math + Gaussian noise
 * for voting decisions. NO AI/LLM at runtime.
 *
 * Architecture:
 *   1. Read env vars (traits, viewport, user type)
 *   2. Navigate site: homepage → setup → calibration → testing → results
 *   3. For each of 16 DOE comparisons: read design matrix from localStorage,
 *      compute penalty based on cognitive traits, add Gaussian noise, vote
 *   4. Handle optimization phase (Fine-Tune or Skip)
 *   5. Download results and save diagnostic JSON
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const TEST_ID      = process.env.TEST_ID      || `fallback_${Date.now()}`;
const BOT_ID       = process.env.BOT_ID       || 'BOT_000';
const VIEWPORT_W   = parseInt(process.env.VIEWPORT_W || '1920', 10);
const VIEWPORT_H   = parseInt(process.env.VIEWPORT_H || '1080', 10);
const USER_TYPE    = process.env.USER_TYPE    || 'adult';    // child | teen | adult
const GRADE_LEVEL  = process.env.GRADE_LEVEL  || 'none';
const V_CROWDING   = parseFloat(process.env.V_CROWDING  || '0.5');
const V_SACCADIC   = parseFloat(process.env.V_SACCADIC  || '0.5');
const V_CONTRAST   = parseFloat(process.env.V_CONTRAST  || '0.5');
const V_ATTENTION  = parseFloat(process.env.V_ATTENTION || '0.5');

const SITE_URL     = process.env.SITE_URL || 'https://lexi-cipher-org-cyan.vercel.app/';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/app/downloads';

// ============================================================
// TUNABLE CONSTANTS
// ============================================================

// Voting threshold: penalty difference must exceed this to vote non-neutral.
// Lower = more non-neutral votes = more likely to trigger significance.
const VOTE_THRESHOLD = 3.0;

// Penalty weights per factor — how much each factor contributes to reading difficulty.
// These are multiplied by the bot's trait value (0-1) and the factor's coded level (-1/+1).
const PENALTY_WEIGHTS = {
  letterSpacing:  15,  // Crowding axis — wider spacing helps crowding-sensitive readers
  wordSpacing:    12,  // Crowding axis
  lineHeight:     18,  // Saccadic axis — taller line height helps saccadic difficulty
  fontWeight:     10,  // Contrast axis — heavier weight helps contrast-sensitive readers
  fontSize:       14,  // Contrast axis — larger size helps
  paragraphWidth: 16,  // Saccadic axis — narrower (40ch at +1) helps saccadic
  bwgt:            8,  // Crowding axis (negative direction — high BWGT = harder)
};

// Which cognitive trait governs each factor, and whether high factor level helps (+1) or hurts (-1)
const FACTOR_TRAIT_MAP = {
  letterSpacing:  { trait: 'crowding',  direction: +1 },  // High (+25%) = easier for crowding-sensitive
  wordSpacing:    { trait: 'crowding',  direction: +1 },  // High (+40%) = easier
  lineHeight:     { trait: 'saccadic',  direction: +1 },  // High (2.0) = easier for saccadic
  fontWeight:     { trait: 'contrast',  direction: +1 },  // High (700) = easier for contrast-sensitive
  fontSize:       { trait: 'contrast',  direction: +1 },  // High (1.25em) = easier
  paragraphWidth: { trait: 'saccadic',  direction: +1 },  // High (40ch narrower) = easier for saccadic
  bwgt:           { trait: 'crowding',  direction: -1 },  // High (100) = MORE visual weight = harder
};

// Map trait names to env var values
const TRAITS = {
  crowding:  V_CROWDING,
  saccadic:  V_SACCADIC,
  contrast:  V_CONTRAST,
};

// ============================================================
// MATH ENGINE — No AI, purely deterministic + stochastic noise
// ============================================================

/**
 * Box-Muller transform for Gaussian random number generation.
 * Returns a normally distributed value with given mean and stdDev.
 */
function gaussianRandom(mean = 0, stdDev = 1) {
  let u1 = Math.random();
  let u2 = Math.random();
  while (u1 === 0) u1 = Math.random(); // Avoid log(0)
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * Calculate how "difficult" a text sample is for this bot's cognitive profile.
 *
 * Uses the coded factor levels (-1/+1) from the DOE design matrix, NOT raw CSS.
 * This aligns exactly with how LexiCipher calculates effects:
 *   effect = 2 * Σ(level × rating) / n
 *
 * The penalty is a weighted sum:
 *   penalty = Σ (factorLevel × weight × traitValue × direction)
 *
 * A LOWER penalty means the sample is EASIER to read for this bot.
 *
 * @param {Object} factorLevels - { letterSpacing: -1|1, wordSpacing: -1|1, ... }
 * @param {Object} traits - { crowding: 0-1, saccadic: 0-1, contrast: 0-1 }
 * @returns {number} - Penalty score (lower = easier to read)
 */
function calculatePenalty(factorLevels, traits) {
  let penalty = 0;

  for (const [factor, config] of Object.entries(FACTOR_TRAIT_MAP)) {
    const level = factorLevels[factor] || 0;        // -1 or +1
    const weight = PENALTY_WEIGHTS[factor] || 0;
    const traitValue = traits[config.trait] || 0;    // 0.0 to 1.0
    const direction = config.direction;              // +1 or -1

    // When direction is +1 and level is +1 (high), this REDUCES penalty
    // for trait-sensitive bots (traitValue > 0).
    // Formula: high level + positive direction = negative contribution to penalty
    penalty -= level * weight * traitValue * direction;
  }

  return penalty;
}

/**
 * Calculate the reference (baseline) penalty.
 * Baseline has all factors at their "neutral" settings which is effectively
 * the low level for base factors. Since baseline CSS is fixed (not from the
 * design matrix), we use a standard reference penalty of 0.
 *
 * The actual penalty difference comes from the test sample having factors
 * at high (+1) or low (-1) levels.
 */
function calculateReferencePenalty() {
  // Baseline is fixed neutral CSS — we define it as penalty = 0.
  // All voting is relative to this baseline.
  return 0;
}

/**
 * Decide the vote: -1 (Worse), 0 (Same), or +1 (Better).
 *
 * If the test sample has LOWER penalty than reference (easier to read),
 * the bot votes "Better" (+1).
 *
 * Gaussian noise simulates human inconsistency — controlled by V_ATTENTION.
 */
function decideVote(testPenalty, referencePenalty) {
  const stdDev = (1.0 - V_ATTENTION) * 10;
  const noise = gaussianRandom(0, stdDev);

  const diff = testPenalty - referencePenalty + noise;

  if (diff < -VOTE_THRESHOLD) return 1;   // Test is easier → "Better"
  if (diff > VOTE_THRESHOLD) return -1;    // Test is harder → "Worse"
  return 0;                                 // No meaningful difference → "Same"
}

// ============================================================
// VERSION CAPTURE — Fingerprint the LexiCipher deployment
// ============================================================

/**
 * Read the pipeline version from package.json.
 */
const PIPELINE_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * Extract the LexiCipher app version from the page.
 *
 * Strategy (in order of preference):
 *   1. Next.js build ID from the HTML comment <!-- <buildId> --> injected by Vercel
 *   2. window.__NEXT_DATA__.buildId (available in older Next.js SSR pages)
 *   3. The buildId embedded in the RSC payload (__next_f)
 *   4. null if none found
 *
 * The build ID changes with every Vercel deployment, making it a reliable
 * version fingerprint even when no explicit semver is exposed.
 */
async function extractAppVersion(page) {
  return await page.evaluate(() => {
    // Strategy 1: __NEXT_DATA__ (classic Next.js SSR)
    if (window.__NEXT_DATA__?.buildId) {
      return window.__NEXT_DATA__.buildId;
    }

    // Strategy 2: RSC payload — look for "b":"<buildId>" in __next_f entries
    if (Array.isArray(window.__next_f)) {
      for (const entry of window.__next_f) {
        if (Array.isArray(entry) && typeof entry[1] === 'string') {
          const match = entry[1].match(/"b":"([^"]+)"/);
          if (match) return match[1];
        }
      }
    }

    // Strategy 3: HTML comment at the top of the document
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue?.trim();
      // Next.js build IDs are alphanumeric, ~20 chars, no spaces
      if (val && /^[A-Za-z0-9_-]{10,30}$/.test(val)) {
        return val;
      }
    }

    // Strategy 4: meta tag (future-proofing)
    const metaVersion = document.querySelector('meta[name="version"], meta[name="build-id"]');
    if (metaVersion) return metaVersion.getAttribute('content');

    return null;
  });
}

/**
 * Compute a short SHA-256 hash of the DOE design matrix.
 * Returns the first 12 hex characters — enough to detect any structural change.
 * If the matrix changes (different factors, levels, or run count), the hash changes.
 */
function hashDoeMatrix(doeMatrix) {
  if (!doeMatrix) return null;
  const canonical = JSON.stringify(doeMatrix, Object.keys(doeMatrix[0] || {}).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

// ============================================================
// CSS EXTRACTION — For logging/validation, not voting decisions
// ============================================================

/**
 * Extract computed CSS styles from the text passage element.
 * Used for diagnostic logging, NOT for voting decisions.
 */
async function extractCSS(page) {
  return await page.evaluate(() => {
    // Primary selector: the paragraph with text-dark-blue class (DOE testing phase)
    let el = document.querySelector('p.text-dark-blue');
    let styleEl = el; // Element to read styles from

    if (!el) {
      // Fallback: optimization phase uses p.text-slate-800, with styles on parent div
      el = document.querySelector('p.text-slate-800');
      if (el) {
        // In OptimizationScreen, inline styles are on the wrapper <div>, not the <p>
        styleEl = el.parentElement || el;
      }
    }

    if (!el) {
      // Last resort fallback
      el = document.querySelector('.text-dark-blue') || document.querySelector('main p');
      styleEl = el;
    }

    if (!el) return null;

    const cs = window.getComputedStyle(styleEl);
    return {
      letterSpacing: cs.letterSpacing,
      wordSpacing: cs.wordSpacing,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      maxWidth: cs.maxWidth,
      fontFamily: cs.fontFamily,
      fontVariationSettings: cs.fontVariationSettings,
    };
  });
}

/**
 * Read the LexiCipher session from localStorage.
 * Returns the parsed session object or null if not found.
 */
async function readSession(page) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('lexicipher_session');
    return raw ? JSON.parse(raw) : null;
  });
}

// ============================================================
// NAVIGATION HELPERS
// ============================================================

/** Click a button/link by visible text, with retry */
async function clickText(page, text, options = {}) {
  const timeout = options.timeout || 15000;
  const locator = page.getByText(text, { exact: options.exact || false });
  await locator.waitFor({ state: 'visible', timeout });
  await locator.click();
}

/** Wait for text to appear on page */
async function waitForText(page, text, options = {}) {
  const timeout = options.timeout || 15000;
  await page.getByText(text).waitFor({ state: 'visible', timeout });
}

/** Check if text is visible without throwing */
async function isTextVisible(page, text, timeout = 3000) {
  try {
    await page.getByText(text).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// BREAK SCREEN HANDLER
// ============================================================

/**
 * Handle the break screen that appears after test 8.
 * Strategy: wait 30s for skip button to appear, then click it.
 * Fallback: wait for auto-dismiss if skip fails.
 */
async function handleBreakScreen(page) {
  const isBreak = await isTextVisible(page, 'Take a Quick Break', 3000);
  if (!isBreak) return false;

  console.log(`[${TEST_ID}] Break screen detected. Waiting 30s for skip button...`);

  // Wait 31 seconds for skip button to appear (it shows after 30s)
  await page.waitForTimeout(31000);

  // Try to click skip
  try {
    const skipBtn = page.getByText('Skip break', { exact: false });
    if (await skipBtn.isVisible({ timeout: 5000 })) {
      await skipBtn.click();
      console.log(`[${TEST_ID}] Break skipped.`);
      return true;
    }
  } catch {
    // Skip button not found
  }

  // Fallback: wait for break to auto-dismiss (remaining ~89s)
  console.log(`[${TEST_ID}] Skip failed. Waiting for break to end...`);
  try {
    await page.getByText('Take a Quick Break').waitFor({ state: 'hidden', timeout: 120000 });
  } catch {
    // Break may have already dismissed
  }
  return true;
}

// ============================================================
// MAIN BOT FLOW
// ============================================================

async function main() {
  const reportDir = path.join(DOWNLOAD_DIR, `REPORT_${TEST_ID}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const votes = [];
  let fineTuneTriggered = false;
  let significantFactorCount = 0;
  let significantFactors = [];
  let optimizationRounds = 0;
  const downloadedFiles = [];
  let appVersion = null;
  let doeMatrixHash = null;

  try {
    // ===== STEP 1: Homepage =====
    console.log(`[${TEST_ID}] Navigating to ${SITE_URL}`);
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Capture app version fingerprint from the homepage (before any navigation)
    appVersion = await extractAppVersion(page);
    console.log(`[${TEST_ID}] App version: ${appVersion || 'unknown'}`);

    await clickText(page, 'Start Free Test');
    console.log(`[${TEST_ID}] Clicked "Start Free Test"`);

    // ===== STEP 2: Welcome Back or Setup =====
    // Fresh Docker container = no localStorage → should go straight to Setup.
    // Handle "Welcome Back" as fallback.
    await page.waitForTimeout(2000); // Allow page to render
    if (await isTextVisible(page, 'Start Fresh', 3000)) {
      await clickText(page, 'Start Fresh');
      console.log(`[${TEST_ID}] Clicked "Start Fresh" (had prior session)`);
    }

    // ===== STEP 3: Demographics =====
    await waitForText(page, 'Get Started', { timeout: 15000 });
    console.log(`[${TEST_ID}] Demographics screen loaded`);

    // Select age group (use getByRole to avoid matching non-button text)
    const ageMap = { child: 'Child', teen: 'Teen', adult: 'Adult' };
    const ageLabel = ageMap[USER_TYPE] || 'Adult';
    await page.getByRole('button', { name: new RegExp(ageLabel, 'i') }).click();
    console.log(`[${TEST_ID}] Selected age group: ${ageLabel}`);

    // Select grade level for child users (conditionally rendered after clicking "Child")
    if (USER_TYPE === 'child') {
      await page.waitForTimeout(500); // Allow grade buttons to render
      const gradeNum = parseInt(GRADE_LEVEL, 10) || 5;
      if (gradeNum <= 3) {
        await clickText(page, '3rd Grade');
      } else if (gradeNum <= 5) {
        await clickText(page, '4th-5th Grade');
      } else {
        await clickText(page, '6th+ Grade');
      }
      console.log(`[${TEST_ID}] Selected grade level: ${GRADE_LEVEL} → clicked grade button`);
    }

    // Check disclaimer checkbox
    await page.locator('input[type="checkbox"]').check();
    console.log(`[${TEST_ID}] Checked disclaimer`);

    // Click continue
    await clickText(page, 'Continue to Calibration');
    console.log(`[${TEST_ID}] Continuing to calibration`);

    // ===== STEP 4: Screen Calibration =====
    await waitForText(page, 'Screen Calibration', { timeout: 15000 });
    await page.getByRole('button', { name: 'Skip (use defaults)' }).click();
    console.log(`[${TEST_ID}] Skipped calibration`);

    // ===== STEP 5: Initial Baseline Phase (ONCE) =====
    // The site shows "Your Reference Sample" with "I've Read It — Start Testing →"
    // exactly ONCE as a separate baseline phase, before the 16-test loop begins.
    await page.getByRole('heading', { name: 'Your Reference Sample' }).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    console.log(`[${TEST_ID}] Baseline reference screen loaded`);

    // Extract baseline CSS for logging
    const baselineCSS = await extractCSS(page);
    console.log(`[${TEST_ID}] Baseline CSS extracted:`, JSON.stringify(baselineCSS));

    // Read the session to verify design matrix is available
    const session = await readSession(page);
    if (!session || !session.doeMatrix) {
      throw new Error('Could not read design matrix from localStorage');
    }
    console.log(`[${TEST_ID}] Design matrix loaded: ${session.doeMatrix.length} runs`);

    // Hash the DOE design matrix for version tracking
    doeMatrixHash = hashDoeMatrix(session.doeMatrix);
    console.log(`[${TEST_ID}] DOE matrix hash: ${doeMatrixHash}`);

    // Calculate reference penalty (baseline = all factors at low/-1 → penalty 0)
    const referencePenalty = calculateReferencePenalty();

    // Click "I've Read It — Start Testing →" to enter the test loop
    await page.getByRole('button', { name: /I've Read It/i }).click();
    // Phase transition: baseline → testing. handleBaselineAcknowledged sets showBaseline=false,
    // so test 1 renders DIRECTLY as Step 2 (vote buttons visible, no "Show Test Sample").
    await page.waitForLoadState('networkidle');
    console.log(`[${TEST_ID}] Clicked "I've Read It" — entering test loop`);

    // ===== STEP 6: Test Loop (16 tests) =====
    // Each test is a 2-step cycle within the TESTING phase:
    //   Step 1 (showBaseline=true): "Step 1 of 2: Reference sample" + "Show Test Sample →"
    //   Step 2 (showBaseline=false): "Step 2 of 2: Compare to reference" + vote buttons
    // After voting, handleRating() sets showBaseline=true → cycles back to step 1.
    // Break screen appears AFTER test 8's vote (phase changes to 'break').

    console.log(`[${TEST_ID}] Starting 16-test comparison loop`);

    for (let testNum = 0; testNum < 16; testNum++) {

      // --- Handle break screen (appears after test 8's vote, before test 9) ---
      if (testNum === 8) {
        const breakHandled = await handleBreakScreen(page);
        if (breakHandled) {
          await page.waitForLoadState('networkidle');
          console.log(`[${TEST_ID}] Resumed after break`);
        }
      }

      // --- Step 1: "Show Test Sample →" (tests 2-16 ONLY) ---
      // Test 1 (testNum=0) skips this: handleBaselineAcknowledged already set
      // showBaseline=false, so test 1 renders directly as Step 2 (vote buttons).
      // Tests 2-16: previous handleRating set showBaseline=true → Step 1 appears.
      if (testNum > 0) {
        try {
          await page.getByRole('button', { name: /Show Test Sample/i }).waitFor({
            state: 'visible',
            timeout: 30000,
          });
        } catch {
          // Maybe break screen appeared at unexpected time — check & handle
          const lateBreak = await handleBreakScreen(page);
          if (lateBreak) {
            console.log(`[${TEST_ID}] Late break handled before test ${testNum + 1}`);
            await page.waitForLoadState('networkidle');
            await page.getByRole('button', { name: /Show Test Sample/i }).waitFor({
              state: 'visible',
              timeout: 30000,
            });
          } else {
            throw new Error(`"Show Test Sample" button not found before test ${testNum + 1}`);
          }
        }

        // Click "Show Test Sample →" to advance to comparison step
        await page.getByRole('button', { name: /Show Test Sample/i }).click();
      }

      // --- Step 2: "Step 2 of 2: Compare to reference" + vote ---
      // Wait for vote buttons to appear (regex: accessible name has emoji prefix "👎 Worse")
      await page.getByRole('button', { name: /Worse/i }).waitFor({
        state: 'visible',
        timeout: 15000,
      });

      // IMPORTANT: Read session BEFORE voting — currentTestIndex points to current test.
      // After voting, handleRating() increments currentTestIndex, so reading after would be off-by-one.
      const currentSession = await readSession(page);
      const currentTestIndex = currentSession?.currentTestIndex ?? testNum;
      const currentRun = currentSession?.doeMatrix?.[currentTestIndex];

      let factorLevels = null;
      let testPenalty = 0;
      let noise = 0;
      let vote = 0;

      if (currentRun && currentRun.parameters) {
        factorLevels = currentRun.parameters;
        testPenalty = calculatePenalty(factorLevels, TRAITS);
        const stdDev = (1.0 - V_ATTENTION) * 10;
        noise = gaussianRandom(0, stdDev);
        const diff = testPenalty - referencePenalty + noise;

        if (diff < -VOTE_THRESHOLD) vote = 1;       // Better
        else if (diff > VOTE_THRESHOLD) vote = -1;   // Worse
        else vote = 0;                                 // Same
      } else {
        // Fallback: couldn't read session, vote based on noise alone
        console.log(`[${TEST_ID}] WARNING: Could not read factor levels for test ${testNum + 1}`);
        const stdDev = (1.0 - V_ATTENTION) * 10;
        noise = gaussianRandom(0, stdDev);
        if (noise < -VOTE_THRESHOLD) vote = 1;
        else if (noise > VOTE_THRESHOLD) vote = -1;
        else vote = 0;
      }

      // Extract comparison CSS for diagnostic logging
      const testCSS = await extractCSS(page);

      // Click the vote button using getByRole with regex (accessible name has emoji prefix)
      const voteLabel = vote === 1 ? 'Better' : vote === -1 ? 'Worse' : 'Same';
      await page.getByRole('button', { name: new RegExp(voteLabel, 'i') }).click();
      // Settle: React batches handleRating() state updates (showBaseline, currentTestIndex, passage)
      await page.waitForTimeout(500);

      // Record vote
      votes.push({
        testNum: testNum + 1,
        runNumber: currentRun?.runNumber ?? null,
        factorLevels,
        extractedCSS: testCSS,
        penalty: testPenalty,
        refPenalty: referencePenalty,
        noise: Math.round(noise * 1000) / 1000,
        vote,
        voteLabel,
      });

      console.log(`[${TEST_ID}] Test ${testNum + 1}/16: vote=${voteLabel} penalty=${testPenalty.toFixed(2)} noise=${noise.toFixed(2)}`);
    }

    console.log(`[${TEST_ID}] All 16 tests completed. Votes: ${votes.map(v => v.voteLabel).join(', ')}`);

    // ===== STEP 8: Optimization Phase =====
    // Wait for either "Fine-Tune" or "View Results"
    await page.waitForTimeout(3000); // Allow calculation and render

    // Read the final session to check significance results
    const finalSession = await readSession(page);
    if (finalSession?.doeResults) {
      significantFactors = finalSession.doeResults.significantFactors || [];
      significantFactorCount = significantFactors.length;
    }

    if (await isTextVisible(page, 'Fine-Tune Settings', 10000)) {
      // PATH A: Fine-Tune triggered — significant factors found!
      fineTuneTriggered = true;
      console.log(`[${TEST_ID}] 🎉 FINE_TUNE_TRIGGERED — ${significantFactorCount} significant factors: ${significantFactors.join(', ')}`);

      await clickText(page, 'Fine-Tune Settings');

      // Complete up to 10 optimization rounds
      for (let optRound = 0; optRound < 10; optRound++) {
        await page.waitForTimeout(2000);

        // Check if optimization is done (we're on results page)
        if (await isTextVisible(page, 'Your Results Are Ready', 2000)) {
          console.log(`[${TEST_ID}] Optimization ended after ${optRound} rounds`);
          break;
        }

        // Wait for vote buttons (optimization comparison uses same RatingInput)
        try {
          await page.getByRole('button', { name: /Worse/i }).waitFor({
            state: 'visible',
            timeout: 10000,
          });
        } catch {
          // Vote buttons didn't appear — optimization may have ended
          if (await isTextVisible(page, 'Your Results Are Ready', 3000)) {
            console.log(`[${TEST_ID}] Optimization ended (results appeared) after ${optRound} rounds`);
            break;
          }
          console.log(`[${TEST_ID}] WARNING: No vote buttons in optimization round ${optRound + 1}`);
          break;
        }

        // Read optimization params from session for trait-based voting
        const optSession = await readSession(page);
        const bayesianRuns = optSession?.bayesianRuns || [];
        const bayesianIndex = optSession?.bayesianIndex ?? optRound;
        const currentBayesianRun = bayesianRuns[bayesianIndex];

        let optVote = 0;
        const stdDev = (1.0 - V_ATTENTION) * 10;
        const optNoise = gaussianRandom(0, stdDev);

        if (currentBayesianRun?.params) {
          // Convert NormalizedParams (0-1) to -1/+1 scale for penalty calculation
          const optFactorLevels = {};
          for (const [key, val] of Object.entries(currentBayesianRun.params)) {
            optFactorLevels[key] = (val - 0.5) * 2; // 0→-1, 0.5→0, 1→+1
          }
          const optPenalty = calculatePenalty(optFactorLevels, TRAITS);
          const diff = optPenalty - referencePenalty + optNoise;

          if (diff < -VOTE_THRESHOLD) optVote = 1;       // Better
          else if (diff > VOTE_THRESHOLD) optVote = -1;   // Worse
          else optVote = 0;                                 // Same
        } else {
          // Fallback: noise-only voting
          if (optNoise < -VOTE_THRESHOLD) optVote = 1;
          else if (optNoise > VOTE_THRESHOLD) optVote = -1;
        }

        const optVoteLabel = optVote === 1 ? 'Better' : optVote === -1 ? 'Worse' : 'Same';
        await page.getByRole('button', { name: new RegExp(optVoteLabel, 'i') }).click();
        await page.waitForTimeout(500); // Settle after vote
        optimizationRounds++;
        console.log(`[${TEST_ID}] Optimization round ${optRound + 1}: ${optVoteLabel}`);
      }

    } else if (await isTextVisible(page, 'View Results', 5000)
            || await isTextVisible(page, 'Skip to Results', 3000)) {
      // PATH B: No significant factors — skip to results
      fineTuneTriggered = false;
      console.log(`[${TEST_ID}] FINE_TUNE_SKIPPED — ${significantFactorCount} significant factors`);

      // Click whichever button is visible
      if (await isTextVisible(page, 'View Results', 2000)) {
        await clickText(page, 'View Results');
      } else {
        await clickText(page, 'Skip to Results');
      }
    }

    // ===== STEP 9: Results Page =====
    // Wait for the specific results heading (Fix #6: avoid matching generic "Results" text)
    await page.getByRole('heading', { name: /Your Results Are Ready/i }).waitFor({
      state: 'visible',
      timeout: 30000,
    });
    console.log(`[${TEST_ID}] Results page loaded`);

    // Handle downloads — site fires TWO separate Blob downloads (CSS then font)
    // Fix #10: Use collector pattern to catch all downloads reliably
    const collectedDownloads = [];
    const downloadListener = (download) => collectedDownloads.push(download);
    page.on('download', downloadListener);

    // Click "Download All Files" (Fix #5: button text has emoji prefix "⬇️ Download All Files")
    const downloadBtn = page.getByRole('button', { name: /Download All Files/i });
    if (await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await downloadBtn.click();
      console.log(`[${TEST_ID}] Clicked "Download All Files"`);

      // Wait for downloads to arrive (CSS is sync, font is async fetch)
      await page.waitForTimeout(8000);

      // Save all collected downloads
      for (const download of collectedDownloads) {
        try {
          const filename = download.suggestedFilename();
          const savePath = path.join(reportDir, filename);
          await download.saveAs(savePath);
          downloadedFiles.push(filename);
          console.log(`[${TEST_ID}] Downloaded: ${filename}`);
        } catch (dlErr) {
          console.log(`[${TEST_ID}] Download save failed: ${dlErr.message}`);
        }
      }
    }

    // Also try "Download Settings (JSON)" (Fix #5: emoji prefix "📥 Download Settings (JSON)")
    const jsonBtn = page.getByRole('button', { name: /Download Settings/i });
    if (await jsonBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      try {
        const jsonDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
        await jsonBtn.click();
        const jsonDownload = await jsonDownloadPromise;
        const jsonFilename = jsonDownload.suggestedFilename();
        await jsonDownload.saveAs(path.join(reportDir, jsonFilename));
        downloadedFiles.push(jsonFilename);
        console.log(`[${TEST_ID}] Downloaded: ${jsonFilename}`);
      } catch {
        console.log(`[${TEST_ID}] JSON settings download failed`);
      }
    }

    // Clean up download listener
    page.off('download', downloadListener);

    // ===== SAVE DIAGNOSTIC VOTE LOG =====
    const voteLog = {
      testId: TEST_ID,
      botId: BOT_ID,
      // Version fingerprints — track which LexiCipher deployment was tested
      siteUrl: SITE_URL,
      appVersion,          // Next.js build ID (changes with every Vercel deployment)
      doeMatrixHash,       // SHA-256 prefix of design matrix (detects DOE structure changes)
      pipelineVersion: PIPELINE_VERSION,  // This bot pipeline's version
      traits: {
        crowding: V_CROWDING,
        saccadic: V_SACCADIC,
        contrast: V_CONTRAST,
        attention: V_ATTENTION,
      },
      userType: USER_TYPE,
      gradeLevel: GRADE_LEVEL,
      viewport: `${VIEWPORT_W}x${VIEWPORT_H}`,
      baselineCSS,
      votes,
      fineTuneTriggered,
      significantFactorCount,
      significantFactors,
      optimizationRounds,
      downloadedFiles,
      completedAt: new Date().toISOString(),
    };

    const voteLogPath = path.join(DOWNLOAD_DIR, `votes_${TEST_ID}.json`);
    fs.writeFileSync(voteLogPath, JSON.stringify(voteLog, null, 2));
    console.log(`[${TEST_ID}] Vote log saved to ${voteLogPath}`);

    // ===== SUCCESS =====
    console.log(`[${TEST_ID}] ✅ Run completed successfully`);
    console.log(`[${TEST_ID}] Significant factors: ${significantFactorCount} — ${significantFactors.join(', ') || 'none'}`);
    console.log(`[${TEST_ID}] Fine-Tune triggered: ${fineTuneTriggered}`);
    console.log(`[${TEST_ID}] Vote distribution: Better=${votes.filter(v=>v.vote===1).length} Same=${votes.filter(v=>v.vote===0).length} Worse=${votes.filter(v=>v.vote===-1).length}`);

    process.exit(0);

  } catch (error) {
    console.error(`[${TEST_ID}] ❌ FAILED: ${error.message}`);
    console.error(error.stack);

    // Save error screenshot
    try {
      await page.screenshot({
        path: path.join(DOWNLOAD_DIR, `ERROR_${TEST_ID}.png`),
        fullPage: true,
      });
      console.log(`[${TEST_ID}] Error screenshot saved`);
    } catch (screenshotErr) {
      console.error(`[${TEST_ID}] Could not save error screenshot: ${screenshotErr.message}`);
    }

    // Save partial vote log if any votes were cast
    if (votes.length > 0) {
      const partialLog = {
        testId: TEST_ID,
        botId: BOT_ID,
        traits: { crowding: V_CROWDING, saccadic: V_SACCADIC, contrast: V_CONTRAST, attention: V_ATTENTION },
        userType: USER_TYPE,
        votes,
        error: error.message,
        fineTuneTriggered: false,
        significantFactorCount: 0,
        significantFactors: [],
        completedAt: null,
      };
      fs.writeFileSync(
        path.join(DOWNLOAD_DIR, `votes_${TEST_ID}.json`),
        JSON.stringify(partialLog, null, 2)
      );
    }

    process.exit(1);

  } finally {
    await browser.close();
  }
}

// Run
main();
