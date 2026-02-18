# Contributing to LexiCipher QA Pipeline

Thank you for contributing! This document defines the branching strategy, commit conventions, and testing requirements for this project.

---

## Branch Strategy

**`main` is always stable and tested.** No direct pushes to `main` — all changes go through a branch and pull request.

### Branch Naming

| Prefix | When to use | Example |
|--------|-------------|---------|
| `feature/` | New capability (new bot trait, new test, new script) | `feature/telemetry-pipeline` |
| `fix/` | Bug fix in any file | `fix/seed-collision` |
| `chore/` | Dependencies, config, docs, tooling | `chore/contributing-guide` |
| `regression-*` | New regression baseline snapshot | `regression-baseline-v2` |

### Workflow

```bash
# 1. Always branch off main
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 2. Make changes, run tests
npm test                  # Jest unit tests (must pass)
npm run test:e2e          # Playwright E2E (required for bot.js / site changes)

# 3. Commit with a descriptive message (see Commit Format below)
git add .
git commit -m "feat: describe what you added"

# 4. Push and open a pull request
git push origin feature/your-feature-name
# → Open PR on GitHub: https://github.com/ajevinger/LexiCipher-QA-pipeline/pulls

# 5. After PR is approved and tests pass → merge to main
git checkout main
git merge --ff-only feature/your-feature-name
git push origin main
```

---

## Required Tests Before Merging

| Change type | `npm test` | `npm run test:e2e` | Manual test |
|-------------|-----------|-------------------|-------------|
| `src/doe-engine.js` or `src/constants.js` | ✅ Required | Optional | — |
| `bot.js` | ✅ Required | ✅ Required | — |
| `run_tests.sh` | ✅ Required | — | Run `./run_tests.sh --parallel 5`, verify diverse traits in `bot_registry.json` |
| `Dockerfile` | ✅ Required | — | `docker build -t lexicipher-bot . && docker run --rm lexicipher-bot node -e "require('./src/doe-engine')"` |
| `tests/` | ✅ Required | ✅ Required | — |
| `README.md` / `CONTRIBUTING.md` | — | — | Proofread |

---

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config, docs |
| `test` | Adding or updating tests |
| `refactor` | Code restructure with no behavior change |
| `perf` | Performance improvement |

**Examples:**
```
feat: add saccadic trait weight to paragraphWidth factor
fix: run_tests.sh — diverse bot traits via Python random
chore: update .gitignore to exclude SQLite WAL files
test: add Jest unit tests for gaussianRandom edge cases
```

---

## GitHub Branch Protection for `main`

To enforce this workflow on GitHub:

1. Go to **https://github.com/ajevinger/LexiCipher-QA-pipeline/settings/branches**
2. Click **"Add branch protection rule"**
3. Branch name pattern: `main`
4. Enable the following:
   - ✅ **Require a pull request before merging**
     - ✅ Require approvals: 1
   - ✅ **Require status checks to pass before merging** *(enable once CI is set up)*
   - ✅ **Do not allow bypassing the above settings**
   - ✅ **Restrict who can push to matching branches** → add yourself only
5. Click **Save changes**

---

## What Gets Committed

| File / Directory | Committed? | Notes |
|-----------------|-----------|-------|
| `bot.js` | ✅ | Main bot runner |
| `src/` | ✅ | Pure DOE math modules |
| `tests/` | ✅ | Jest + Playwright test suites |
| `bot_registry.json` | ✅ | Persistent bot identity database |
| `bot_data.db` | ✅ | SQLite results database |
| `test_reports/` | ❌ | Git-ignored — runtime output |
| `test-results/` | ❌ | Git-ignored — Playwright artifacts |
| `node_modules/` | ❌ | Git-ignored — run `npm install` |
| `*.db-shm`, `*.db-wal` | ❌ | Git-ignored — SQLite WAL temp files |
| `.env` | ❌ | Git-ignored — never commit secrets |
