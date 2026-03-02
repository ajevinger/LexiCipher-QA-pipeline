'use strict';
/**
 * screening.spec.js — Playwright E2E regression baseline for LexiCipher.
 *
 * Navigates the full screening phase (16 DOE comparisons) using a zero-trait
 * neutral bot (all traits = 0) so every vote is "Same" — deterministic, fast,
 * and independent of font preferences.
 *
 * Asserts:
 *   1. The DOE design matrix loads with exactly 16 runs
 *   2. All 16 comparison screens are reachable and voteable
 *   3. The results page appears after voting
 *   4. "Download All Files" triggers at least one file download (font pipeline)
 *
 * Run: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

const SITE_URL = process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/';
const EXPECTED_DOE_RUNS = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the lexicipher_session from localStorage and parse it. */
async function readSession(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('lexicipher_session');
    return raw ? JSON.parse(raw) : null;
  });
}

/** Return true if the locator is visible within timeout ms, without throwing. */
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

test.describe('LexiCipher Screening Phase — Regression Baseline', () => {

  test('completes all 16 DOE comparisons and triggers font download', async ({ page }) => {

    // ── STEP 1: Homepage ──────────────────────────────────────────────────
    // Use domcontentloaded instead of networkidle — Next.js App Router streams
    // RSC chunks after initial HTML, so networkidle can be unreliable.
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });

    // Wait for the CTA button — it may be an <a> or <button>
    const startBtn = page.getByText('Start Free Test', { exact: false });
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    await startBtn.click();

    // ── STEP 2: Handle "Welcome Back" if prior session exists ─────────────
    await page.waitForTimeout(2000);
    const startFresh = page.getByRole('button', { name: /Start Fresh/i });
    if (await isVisible(startFresh, 3000)) {
      await startFresh.click();
    }

    // ── STEP 3: Demographics ──────────────────────────────────────────────
    // Heading is "Let's Get Started" on the live site
    await expect(
      page.getByRole('heading', { name: /Get Started/i })
    ).toBeVisible({ timeout: 15000 });

    // Age group cards — use getByText since they may not have button role
    await page.getByText('Adult', { exact: true }).click();

    // Accept disclaimer checkbox
    await page.locator('input[type="checkbox"]').check();

    // Continue to calibration — scroll into view first in case it's below fold
    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // ── STEP 4: Screen Calibration ────────────────────────────────────────
    await expect(page.getByText('Screen Calibration')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Skip.*defaults/i }).click();

    // ── STEP 5: Baseline Reference Screen ────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Your Reference Sample/i })
    ).toBeVisible({ timeout: 15000 });

    // Assert DOE matrix is loaded with exactly 16 runs
    const sessionAfterBaseline = await readSession(page);
    expect(sessionAfterBaseline).not.toBeNull();
    expect(sessionAfterBaseline.doeMatrix).toBeDefined();
    expect(sessionAfterBaseline.doeMatrix).toHaveLength(EXPECTED_DOE_RUNS);

    // Acknowledge baseline — enters the test loop
    await page.getByRole('button', { name: /I've Read It/i }).click();
    await page.waitForLoadState('domcontentloaded');

    // ── STEP 6: 16-Test Comparison Loop ───────────────────────────────────
    // Zero-trait bot: penalty = 0 for all runs → always vote "Same"
    for (let testNum = 0; testNum < EXPECTED_DOE_RUNS; testNum++) {

      // Tests 2–16: click "Show Test Sample" first
      if (testNum > 0) {
        const showBtn = page.getByRole('button', { name: /Show Test Sample/i });
        await expect(showBtn).toBeVisible({ timeout: 30000 });
        await showBtn.click();
      }

      // Wait for vote buttons
      const sameBtn = page.getByRole('button', { name: /Same/i });
      await expect(sameBtn).toBeVisible({ timeout: 20000 });

      // Assert all three vote buttons are present
      await expect(page.getByRole('button', { name: /Better/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Worse/i })).toBeVisible();

      // Vote "Same" (neutral — zero-trait bot has no preference)
      await sameBtn.click();
      await page.waitForTimeout(400); // Allow React state to settle

      // After test 8, handle the break screen if it appears
      if (testNum === 7) {
        const breakHeading = page.getByText('Take a Quick Break');
        if (await isVisible(breakHeading, 5000)) {
          // Wait for skip button (appears after 30s)
          const skipBtn = page.getByRole('button', { name: /Skip break/i });
          await expect(skipBtn).toBeVisible({ timeout: 35000 });
          await skipBtn.click();
          await page.waitForLoadState('domcontentloaded');
        }
      }
    }

    // ── STEP 7: Post-screening — assert "View Results" only (no Fine-Tune) ──
    // With a zero-trait bot all effects = 0 → no factor is significant →
    // Fine-Tune Settings must NOT appear; only View Results should be offered.
    await page.waitForTimeout(3000); // Allow DOE calculation to complete

    const fineTuneBtn    = page.getByRole('button', { name: /Fine-Tune Settings/i });
    const viewResultsBtn = page.getByRole('button', { name: /View Results/i });

    // Zero-trait bot must never trigger Fine-Tune
    expect(await isVisible(fineTuneBtn, 3000)).toBe(false);

    await expect(viewResultsBtn).toBeVisible({ timeout: 10000 });
    await viewResultsBtn.click();

    // ── STEP 8: Results Page ──────────────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Your Results Are Ready/i })
    ).toBeVisible({ timeout: 30000 });

    // ── STEP 9: Font Download ─────────────────────────────────────────────
    const downloadBtn = page.getByRole('button', { name: /Download All Files/i });
    await expect(downloadBtn).toBeVisible({ timeout: 10000 });

    // Collect downloads — site fires Blob downloads for CSS + font file
    const downloads = [];
    page.on('download', (dl) => downloads.push(dl));

    await downloadBtn.click();

    // Wait up to 10s for at least one download to arrive
    await page.waitForTimeout(10000);

    // Assert at least one file was downloaded (font pipeline is working)
    expect(downloads.length).toBeGreaterThanOrEqual(1);

    // Assert at least one downloaded file has a meaningful filename
    const filenames = downloads.map((d) => d.suggestedFilename());
    const hasFont = filenames.some(
      (f) =>
        f.endsWith('.woff2') ||
        f.endsWith('.woff')  ||
        f.endsWith('.ttf')   ||
        f.endsWith('.otf')   ||
        f.endsWith('.css')   ||
        f.endsWith('.json')
    );
    expect(hasFont).toBe(true);
  });

});
