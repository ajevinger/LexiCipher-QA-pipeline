'use strict';
/**
 * fine-tune.spec.js — E2E test that guarantees the Fine-Tune phase appears.
 *
 * Strategy
 * ────────
 * With tCritical=0.5 (the app's current threshold), even a modest signal is
 * flagged as significant.  For each of the 16 DOE comparisons this test reads
 * the current run's letterSpacing parameter from localStorage and votes:
 *
 *   letterSpacing = +1  →  "Better"  (positive effect)
 *   letterSpacing = -1  →  "Same"    (neutral)
 *
 * This produces a large, clean letterSpacing main effect.  With 8 high-level
 * runs all rated "Better" and 8 low-level runs rated "Same":
 *   effect_letterSpacing = 2 × (8×1×1 + 8×(-1)×0) / 16 = 1.0
 *   SE ≈ small → t >> 0.5 → letterSpacing is significant → Fine-Tune appears.
 *
 * Asserts:
 *   1. "Fine-Tune Settings" button appears after the 16 comparisons
 *   2. Clicking Fine-Tune enters the optimization phase
 *   3. Results page is reachable after one optimization vote
 *
 * Run: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

const SITE_URL = process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/';
const EXPECTED_DOE_RUNS = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readSession(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('lexicipher_session');
    return raw ? JSON.parse(raw) : null;
  });
}

async function isVisible(locator, timeout = 5000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Fine-Tune phase — guaranteed trigger', () => {

  test('signal-driven voting produces significant factors → Fine-Tune button appears', async ({ page }) => {

    // ── STEP 1: Navigate and handle welcome-back ──────────────────────────
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    const startBtn = page.getByText('Start Free Test', { exact: false });
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    await startBtn.click();

    await page.waitForTimeout(2000);
    const startFresh = page.getByRole('button', { name: /Start Fresh/i });
    if (await isVisible(startFresh, 3000)) {
      await startFresh.click();
    }

    // ── STEP 2: Demographics (Adult — no grade-level noise) ───────────────
    await expect(
      page.getByRole('heading', { name: /Get Started/i })
    ).toBeVisible({ timeout: 15000 });

    await page.getByText('Adult', { exact: true }).click();
    await page.locator('input[type="checkbox"]').check();

    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // ── STEP 3: Screen Calibration ────────────────────────────────────────
    await expect(page.getByText('Screen Calibration')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Skip.*defaults/i }).click();

    // ── STEP 4: Baseline Reference Screen ────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Your Reference Sample/i })
    ).toBeVisible({ timeout: 15000 });

    // Pre-read the DOE matrix before entering the comparison loop so we know
    // each run's letterSpacing level without racing against vote writes.
    const initSession = await readSession(page);
    const votePlan = (initSession?.doeMatrix ?? []).map((row) =>
      row.parameters?.letterSpacing === 1 ? 'Better' : 'Same'
    );

    await page.getByRole('button', { name: /I've Read It/i }).click();
    await page.waitForLoadState('domcontentloaded');

    // ── STEP 5: 16 DOE comparisons with signal-driven voting ──────────────
    for (let testNum = 0; testNum < EXPECTED_DOE_RUNS; testNum++) {

      // Tests 2–16: reveal the test sample first
      if (testNum > 0) {
        const showBtn = page.getByRole('button', { name: /Show Test Sample/i });
        await expect(showBtn).toBeVisible({ timeout: 30000 });
        await showBtn.click();
      }

      // Wait for vote buttons to appear
      const sameBtn = page.getByRole('button', { name: /Same/i });
      await expect(sameBtn).toBeVisible({ timeout: 20000 });

      // Use the pre-computed vote plan (indexed by matrix position = presentation order)
      const vote = votePlan[testNum] ?? 'Same';

      if (vote === 'Better') {
        await page.getByRole('button', { name: /Better/i }).click();
      } else {
        await sameBtn.click();
      }

      await page.waitForTimeout(400); // let React state settle

      // Mid-test break screen (after run 8)
      if (testNum === 7) {
        const breakHeading = page.getByText('Take a Quick Break');
        if (await isVisible(breakHeading, 5000)) {
          const skipBtn = page.getByRole('button', { name: /Skip break/i });
          await expect(skipBtn).toBeVisible({ timeout: 35000 });
          await skipBtn.click();
          await page.waitForLoadState('domcontentloaded');
        }
      }
    }

    // ── STEP 6: Post-screening — assert Fine-Tune button appears ──────────
    await page.waitForTimeout(3000); // allow DOE calculation to complete

    const fineTuneBtn = page.getByRole('button', { name: /Fine-Tune Settings/i });
    await expect(fineTuneBtn).toBeVisible({ timeout: 10000 });

    // ── STEP 7: Enter Fine-Tune and reach results ─────────────────────────
    await fineTuneBtn.click();

    // Loop through all optimization rounds (Bayesian optimizer runs up to 10 trials).
    // Vote "Same" (neutral) for each round; stop early if a navigation button appears.
    for (let optRound = 0; optRound < 15; optRound++) {
      const skipBtn = page.getByRole('button', { name: /View Results|Skip to Results/i });
      if (await isVisible(skipBtn, 1000)) {
        await skipBtn.click();
        break;
      }
      const optSameBtn = page.getByRole('button', { name: /Same/i });
      if (!(await isVisible(optSameBtn, 15000))) break;
      await optSameBtn.click();
      await page.waitForTimeout(400);
    }

    // After loop: if page hasn't navigated automatically, click results button
    const resultsBtn = page.getByRole('button', { name: /View Results|Skip to Results/i });
    if (await isVisible(resultsBtn, 10000)) {
      await resultsBtn.click();
    }

    // ── STEP 8: Results page ──────────────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Your Results Are Ready/i })
    ).toBeVisible({ timeout: 30000 });
  });
});
