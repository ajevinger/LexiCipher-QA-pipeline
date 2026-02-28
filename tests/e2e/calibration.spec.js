'use strict';
/**
 * calibration.spec.js — E2E test for the screen calibration interaction.
 *
 * Strategy
 * ────────
 * All other E2E tests skip calibration with "Skip (use defaults)".  This test
 * exercises the actual drag-to-resize interaction on the credit-card ruler:
 *
 *   1. Locate the right-edge resize handle (cursor: ew-resize)
 *   2. Drag it 60px to the right using low-level mouse events
 *   3. Click "Continue →" to accept the calibrated size
 *   4. Verify we advance past calibration to "Your Reference Sample"
 *   5. Verify localStorage has a saved calibration with a valid ppi value
 *
 * The test clears localStorage before navigation to guarantee a fresh session
 * (no "Welcome Back" modal, no prior calibration data).
 *
 * Asserts:
 *   1. Calibration screen heading and both buttons appear
 *   2. Drag interaction doesn't crash the UI
 *   3. "Continue →" advances to the baseline reference screen
 *   4. session.calibration.ppi is a positive number in localStorage
 *
 * Run: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

const SITE_URL = process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

test.describe('Screen Calibration — drag interaction', () => {

  test('drag-to-resize + Continue → advances to baseline and saves calibration', async ({ page }) => {

    // ── STEP 1: Clear localStorage so there's no "Welcome Back" modal ─────
    await page.addInitScript(() => {
      localStorage.removeItem('lexicipher_session');
    });

    // ── STEP 2: Navigate and start ────────────────────────────────────────
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    const startBtn = page.getByText('Start Free Test', { exact: false });
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    await startBtn.click();

    // ── STEP 3: Demographics (Adult) ──────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Get Started/i })
    ).toBeVisible({ timeout: 15000 });

    await page.getByText('Adult', { exact: true }).click();
    await page.locator('input[type="checkbox"]').check();

    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // ── STEP 4: Calibration screen ────────────────────────────────────────
    await expect(page.getByText('Screen Calibration')).toBeVisible({ timeout: 15000 });

    // Both action buttons must be present
    const skipBtn     = page.getByRole('button', { name: 'Skip (use defaults)' });
    const continueCalBtn = page.getByRole('button', { name: 'Continue →' });
    await expect(skipBtn).toBeVisible({ timeout: 5000 });
    await expect(continueCalBtn).toBeVisible({ timeout: 5000 });

    // ── STEP 5: Drag the resize handle 60px to the right ─────────────────
    // The handle has the Tailwind class cursor-ew-resize (not an inline style).
    const handle = page.locator('.cursor-ew-resize').first();
    await handle.waitFor({ state: 'visible', timeout: 10000 });

    const box = await handle.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300); // let React state settle
    }

    // ── STEP 6: Accept calibration ────────────────────────────────────────
    await continueCalBtn.click();

    // ── STEP 7: Assert we advanced to the baseline reference screen ───────
    await expect(
      page.getByRole('heading', { name: /Your Reference Sample/i })
    ).toBeVisible({ timeout: 20000 });

    // ── STEP 8: Verify calibration data was saved to localStorage ─────────
    const session = await page.evaluate(() => {
      const raw = localStorage.getItem('lexicipher_session');
      return raw ? JSON.parse(raw) : null;
    });

    expect(session?.calibration).toBeDefined();
    expect(typeof session.calibration.ppi).toBe('number');
    expect(session.calibration.ppi).toBeGreaterThan(0);
    expect(session.calibration.calibratedAt).toBeTruthy();
  });
});
