'use strict';
/**
 * session-resume.spec.js — E2E test for the "Welcome Back" session resume flow.
 *
 * Strategy
 * ────────
 * Build a real partial session by completing demographics + calibration skip +
 * baseline + 3 DOE votes, then reload the page.  The app reads lexicipher_session
 * from localStorage, finds phase='doe-testing' and updatedAt < 24h ago, and shows
 * the "Welcome Back!" resume prompt.
 *
 * Clicking "Continue Test →" should restore the session at DOE run 4 (index 3).
 *
 * Asserts:
 *   1. After reload, "Welcome Back!" heading is visible
 *   2. "Continue Test →" button is visible (not just "Start Fresh")
 *   3. Clicking Continue lands back in the DOE comparison loop
 *   4. localStorage still has exactly 3 responses and currentTestIndex === 3
 *
 * Run: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

const SITE_URL = process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/';

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

test.describe('Session resume — Welcome Back flow', () => {

  test('partial session survives reload and resumes at the correct DOE run', async ({ page }) => {

    // ── STEP 1: Navigate and start fresh ─────────────────────────────────
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    const startBtn = page.getByText('Start Free Test', { exact: false });
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    await startBtn.click();

    await page.waitForTimeout(2000);
    const startFresh = page.getByRole('button', { name: /Start Fresh/i });
    if (await isVisible(startFresh, 3000)) {
      await startFresh.click();
    }

    // ── STEP 2: Demographics (Adult) ──────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Get Started/i })
    ).toBeVisible({ timeout: 15000 });

    await page.getByText('Adult', { exact: true }).click();
    await page.locator('input[type="checkbox"]').check();

    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // ── STEP 3: Skip calibration ──────────────────────────────────────────
    await expect(page.getByText('Screen Calibration')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Skip.*defaults/i }).click();

    // ── STEP 4: Acknowledge baseline ──────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Your Reference Sample/i })
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /I've Read It/i }).click();
    await page.waitForLoadState('domcontentloaded');

    // ── STEP 5: Vote "Same" 3 times to build a partial session ────────────
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        const showBtn = page.getByRole('button', { name: /Show Test Sample/i });
        await expect(showBtn).toBeVisible({ timeout: 30000 });
        await showBtn.click();
      }
      const sameBtn = page.getByRole('button', { name: /Same/i });
      await expect(sameBtn).toBeVisible({ timeout: 20000 });
      await sameBtn.click();
      await page.waitForTimeout(400);
    }

    // Verify 3 responses are saved before reload
    const sessionBeforeReload = await readSession(page);
    expect(sessionBeforeReload?.doeResponses).toHaveLength(3);
    expect(sessionBeforeReload?.currentTestIndex).toBe(3);

    // ── STEP 6: Reload the page ───────────────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });

    // ── STEP 7: Assert "Welcome Back!" modal ─────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Welcome Back/i })
    ).toBeVisible({ timeout: 20000 });

    const continueTestBtn = page.getByRole('button', { name: /Continue Test/i });
    await expect(continueTestBtn).toBeVisible({ timeout: 5000 });

    // ── STEP 8: Resume session ────────────────────────────────────────────
    await continueTestBtn.click();

    // We should be at DOE run 4 — "Show Test Sample" button appears for runs 2+
    const showBtn = page.getByRole('button', { name: /Show Test Sample/i });
    await expect(showBtn).toBeVisible({ timeout: 20000 });

    // ── STEP 9: Verify session integrity after resume ─────────────────────
    const sessionAfterResume = await readSession(page);
    expect(sessionAfterResume?.doeResponses).toHaveLength(3);
    expect(sessionAfterResume?.currentTestIndex).toBe(3);
  });
});
