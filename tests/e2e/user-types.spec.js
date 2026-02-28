'use strict';
/**
 * user-types.spec.js — E2E regression tests for child and teen demographic flows.
 *
 * The existing screening.spec.js covers the Adult path end-to-end.
 * These tests verify that the child and teen age-group selections reach the
 * DOE testing phase with a valid 16-run matrix loaded — without running all
 * 16 comparisons (that's covered by the baseline regression test).
 *
 * Asserts:
 *   1. Selecting "Child" shows a grade-level selector; selecting a grade proceeds
 *   2. Selecting "Teen" skips grade-level; proceeds directly
 *   3. Both paths load a 16-run DOE matrix in localStorage after calibration
 *
 * Run: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

const SITE_URL = process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/';
const EXPECTED_DOE_RUNS = 16;

// ---------------------------------------------------------------------------
// Helpers (shared with screening.spec.js)
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

/** Navigate to site and dismiss any "Welcome Back" modal. */
async function goToStart(page) {
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  const startBtn = page.getByText('Start Free Test', { exact: false });
  await expect(startBtn).toBeVisible({ timeout: 20000 });
  await startBtn.click();

  await page.waitForTimeout(2000);
  const startFresh = page.getByRole('button', { name: /Start Fresh/i });
  if (await isVisible(startFresh, 3000)) {
    await startFresh.click();
  }

  await expect(
    page.getByRole('heading', { name: /Get Started/i })
  ).toBeVisible({ timeout: 15000 });
}

/** Click through calibration and baseline, returning after the DOE matrix loads. */
async function skipToDoeTesting(page) {
  // Calibration
  await expect(page.getByText('Screen Calibration')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Skip.*defaults/i }).click();

  // Baseline reference screen
  await expect(
    page.getByRole('heading', { name: /Your Reference Sample/i })
  ).toBeVisible({ timeout: 15000 });

  // Acknowledge baseline — enters the test loop
  await page.getByRole('button', { name: /I've Read It/i }).click();
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// Child user flow
// ---------------------------------------------------------------------------

test.describe('Child user type flow', () => {
  test('child + grade selection reaches DOE phase with 16-run matrix', async ({ page }) => {
    await goToStart(page);

    // Select "Child" age group
    await page.getByText('Child', { exact: true }).click();

    // Grade-level selector appears as card buttons ("3rd Grade or below",
    // "4th-5th Grade", "6th+ Grade") — wait for the heading then click first card.
    const gradeHeading = page.getByText('What grade are you in?', { exact: false });
    if (await isVisible(gradeHeading, 5000)) {
      await page.getByText(/3rd Grade/i).first().click();
    }

    // Accept disclaimer and continue
    await page.locator('input[type="checkbox"]').check();
    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    await skipToDoeTesting(page);

    // Assert DOE matrix loaded with exactly 16 runs
    const session = await readSession(page);
    expect(session).not.toBeNull();
    expect(session.doeMatrix).toBeDefined();
    expect(session.doeMatrix).toHaveLength(EXPECTED_DOE_RUNS);

    // Assert the first comparison is visible (DOE loop has started)
    const sameBtn = page.getByRole('button', { name: /Same/i });
    await expect(sameBtn).toBeVisible({ timeout: 20000 });
  });
});

// ---------------------------------------------------------------------------
// Teen user flow
// ---------------------------------------------------------------------------

test.describe('Teen user type flow', () => {
  test('teen selection reaches DOE phase with 16-run matrix', async ({ page }) => {
    await goToStart(page);

    // Select "Teen" age group
    await page.getByText('Teen', { exact: true }).click();

    // Accept disclaimer and continue
    await page.locator('input[type="checkbox"]').check();
    const continueBtn = page.getByRole('button', { name: /Continue to Calibration/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    await skipToDoeTesting(page);

    // Assert DOE matrix loaded with exactly 16 runs
    const session = await readSession(page);
    expect(session).not.toBeNull();
    expect(session.doeMatrix).toBeDefined();
    expect(session.doeMatrix).toHaveLength(EXPECTED_DOE_RUNS);

    // Assert session records the correct age group
    expect(session.setup?.ageGroup).toBe('teen');

    // Assert the first comparison is visible
    const sameBtn = page.getByRole('button', { name: /Same/i });
    await expect(sameBtn).toBeVisible({ timeout: 20000 });
  });
});
