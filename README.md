# LexiCipher Bot Pipeline

Automated testing pipeline for [LexiCipher.org](https://lexicipher.org) — a dyslexia font optimization tool that uses **Design of Experiments (DOE)** methodology to find personalized typography settings for readers with dyslexia.

This pipeline generates synthetic "reader bots" with randomized cognitive trait profiles, runs them through the full LexiCipher test flow in isolated Docker containers, and aggregates results for statistical analysis.

---

## How It Works

### The Target: LexiCipher.org

LexiCipher presents users with 16 pairwise comparisons between a baseline font (Roboto) and test samples using the LexiCipher variable font. Each test sample varies 7 typographic factors across a **fractional factorial DOE design matrix**:

| Factor | Low (−1) | High (+1) | Cognitive axis |
|---|---|---|---|
| `letterSpacing` | normal | +25% | Crowding |
| `wordSpacing` | 0px | +40% | Crowding |
| `lineHeight` | 1.3× | 2.0× | Saccadic |
| `fontWeight` | 300 | 700 | Contrast |
| `fontSize` | 0.9em | 1.25em | Contrast |
| `paragraphWidth` | wide | 40ch narrow | Saccadic |
| `bwgt` (BWGT axis) | 0 | 100 | Contrast (negative) |

After 16 votes, LexiCipher runs a DOE effect analysis. If significant factors are found, it enters a **Bayesian optimization** (Fine-Tune) phase to converge on the optimal settings, then generates a personalized font file.

### The Bot

Each bot is assigned a **cognitive trait profile** — four values between 0.0 and 1.0:

- **Crowding** (`V_CROWDING`) — sensitivity to letter/word crowding
- **Saccadic** (`V_SACCADIC`) — difficulty with eye movement across lines
- **Contrast** (`V_CONTRAST`) — sensitivity to font weight and size
- **Attention** (`V_ATTENTION`) — consistency of responses (higher = less noise)

The bot uses a **deterministic penalty function** to decide each vote:

```
penalty = −Σ (factorLevel × weight × traitValue × direction)
```

A lower penalty means the test sample is *easier* to read for this bot's profile. Gaussian noise (controlled by `V_ATTENTION`) simulates human inconsistency. **No AI/LLM is used at runtime.**

### The Pipeline

```
run_tests.sh
    │
    ├── Generates N bots with random trait profiles
    ├── Builds Docker image (once)
    ├── Runs each bot in an isolated container
    │       └── bot.js (Playwright) → LexiCipher.org
    │               ├── Setup → Calibration → Baseline
    │               ├── 16 DOE comparison votes
    │               ├── Break screen (after test 8)
    │               ├── Fine-Tune optimization (if triggered)
    │               └── Download results + save vote log
    │
    ├── Updates bot_registry.json
    ├── Appends to test_reports/summary.csv
    └── Generates test_reports/dashboard_data.js
```

---

## Prerequisites

- **Docker Desktop** (running) — [Install](https://www.docker.com/products/docker-desktop/)
- **Python 3** — for registry/dashboard data generation
- **Bash** — WSL2, Git Bash, or macOS/Linux terminal
- Internet access to `lexi-cipher-org-cyan.vercel.app`

---

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd lexicipher-qa-pipeline

# Run 1 bot (smoke test)
./run_tests.sh 1

# Run 10 bots sequentially
./run_tests.sh 10

# Run 20 bots with up to 4 running in parallel
./run_tests.sh --parallel 20

# Replay a specific bot with its original traits
./run_tests.sh --replay BOT_042

# Run a bwgt isolation test (controlled high-contrast profile, other factors suppressed)
./run_tests.sh --bwgt-test 10
```

> **Windows users:** Run these commands in WSL2 or Git Bash. Docker Desktop must be running first.

### bwgt Isolation Mode

`--bwgt-test [N]` runs N bots (default 10) with a controlled profile designed to isolate the BWGT font axis:

| Trait | Range | Purpose |
|---|---|---|
| `V_CROWDING` | 0.01–0.10 | Suppressed — crowding factors won't dominate |
| `V_SACCADIC` | 0.01–0.10 | Suppressed — saccadic factors won't dominate |
| `V_CONTRAST` | 0.90–0.99 | High — contrast factors (including bwgt) are detectable |
| `V_ATTENTION` | 0.95 | Fixed — low noise for clean signal |

Use this mode to verify that bwgt is detectable for contrast-sensitive user profiles, or to test changes to bwgt's penalty weight or trait mapping.

---

## Output Files

| File | Description |
|---|---|
| `test_reports/summary.csv` | One row per run: bot ID, traits, exit code, duration |
| `test_reports/votes_<TEST_ID>.json` | Full vote log with factor levels, penalties, CSS |
| `test_reports/REPORT_<TEST_ID>/` | Downloaded font + CSS files from LexiCipher |
| `test_reports/dashboard_data.js` | Auto-generated JS data for the dashboard |
| `bot_registry.json` | Persistent bot identity database (enables replay) |

### Viewing the Dashboard

Open `dashboard.html` in a browser after running tests:

```bash
# macOS / Linux
open dashboard.html

# Windows (from Git Bash or WSL2)
explorer.exe dashboard.html

# Or serve locally to avoid any CORS issues
python3 -m http.server 8080
# then open http://localhost:8080/dashboard.html
```

---

## Configuration

### Environment Variables (per bot)

| Variable | Default | Description |
|---|---|---|
| `TEST_ID` | `fallback_<timestamp>` | Unique run identifier |
| `BOT_ID` | `BOT_000` | Bot identifier |
| `VIEWPORT_W` / `VIEWPORT_H` | `1920` / `1080` | Browser viewport |
| `USER_TYPE` | `adult` | `child` \| `teen` \| `adult` |
| `GRADE_LEVEL` | `none` | Grade number (for child/teen) |
| `V_CROWDING` | `0.5` | Crowding sensitivity (0.0–1.0) |
| `V_SACCADIC` | `0.5` | Saccadic difficulty (0.0–1.0) |
| `V_CONTRAST` | `0.5` | Contrast sensitivity (0.0–1.0) |
| `V_ATTENTION` | `0.5` | Response consistency (0.0–1.0) |
| `SITE_URL` | `https://lexi-cipher-org-cyan.vercel.app/` | Target site |
| `DOWNLOAD_DIR` | `/app/downloads` | Output directory inside container |

### Pipeline Variables

| Variable | Default | Description |
|---|---|---|
| `MAX_PARALLEL` | `4` | Max concurrent containers (parallel mode) |
| `MAX_RETRIES` | `1` | Auto-retry count on failure |

Override at runtime:
```bash
MAX_PARALLEL=8 MAX_RETRIES=2 ./run_tests.sh --parallel 50
```

---

## Tuning the Bot

### Penalty Weights

Edit `PENALTY_WEIGHTS` in `src/constants.js` to adjust how much each factor contributes to reading difficulty:

```js
const PENALTY_WEIGHTS = {
  letterSpacing:  15,  // Crowding axis
  wordSpacing:    12,  // Crowding axis
  lineHeight:     18,  // Saccadic axis
  fontWeight:     10,  // Contrast axis
  fontSize:       14,  // Contrast axis
  paragraphWidth: 16,  // Saccadic axis
  bwgt:           14,  // Contrast axis (negative direction — heavy strokes reduce contrast)
};
```

### Vote Threshold

`VOTE_THRESHOLD = 3.0` — the penalty difference must exceed this to cast a non-neutral vote. Lower values produce more "Better"/"Worse" votes and increase the likelihood of triggering Fine-Tune.

---

## Smoke Test Results

Verified working on **2026-02-18** against `lexi-cipher-org-cyan.vercel.app`.

**Bot profile:**
```
BOT_ID:     BOT_SMOKE
Viewport:   1920×1080
User type:  adult
Crowding:   0.90  (high — very sensitive to letter/word crowding)
Saccadic:   0.90  (high — significant eye movement difficulty)
Contrast:   0.70  (moderate-high — benefits from larger, heavier text)
Attention:  0.95  (very high — highly consistent responses)
```

**Results:**
```
Tests completed:       16/16
Vote distribution:     Better=6  Same=3  Worse=7
Fine-Tune triggered:   ✅ YES
Significant factors:   wordSpacing, fontSize
Optimization rounds:   10
Downloaded files:      lexicipher-settings.css
                       OpenDyslexic-Personalized.otf
                       lexicipher-settings.json
Completed at:          2026-02-18T08:16:09Z
Duration:              ~2 minutes
```

**Vote log excerpt** (first 4 of 16 tests):

| Test | Run | wordSpacing | fontSize | Penalty | Vote |
|---|---|---|---|---|---|
| 1 | 6 | −1 (0px) | +1 (20px) | −0.10 | Same |
| 2 | 1 | −1 (0px) | −1 (14.4px) | +64.50 | Worse |
| 3 | 2 | −1 (0px) | −1 (14.4px) | +37.50 | Worse |
| 4 | 16 | +1 (5.76px) | −1 (14.4px) | −30.50 | Better |

The bot correctly identified that **wider word spacing** and **larger font size** are the most significant factors for its cognitive profile — consistent with the high crowding and contrast trait values.

---

## Architecture Notes

### Why Deterministic Math (No AI)?

Using a fixed penalty function means:
- Results are **reproducible** — replay any bot with `--replay BOT_XXX`
- Trait effects are **interpretable** — you can reason about why a bot voted the way it did
- The pipeline generates **statistically valid DOE data** — votes are correlated with factor levels in a principled way

### Why Docker?

Each bot runs in a fresh container with no localStorage state, ensuring clean test sessions. The Playwright image (`mcr.microsoft.com/playwright:v1.52.0-noble`) includes all browser dependencies.

### Parallelism & Safety

In `--parallel` mode, multiple containers run concurrently. CSV writes use `flock` to prevent corruption. The registry is updated sequentially (one Python call per bot completion).

---

## Project Structure

```
lexicipher-qa-pipeline/
├── bot.js              # Playwright bot — navigation + voting logic
├── run_tests.sh        # Pipeline orchestrator — batch/parallel/replay
├── dashboard.html      # Static HTML dashboard (no server needed)
├── Dockerfile          # Playwright container definition
├── package.json        # Node.js dependencies (playwright only)
├── bot_registry.json   # Persistent bot database (git-ignored)
└── test_reports/       # All output files (git-ignored)
    ├── summary.csv
    ├── votes_<TEST_ID>.json
    ├── REPORT_<TEST_ID>/
    └── dashboard_data.js
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Branch naming conventions (`feature/`, `fix/`, `chore/`, `regression-*`)
- Required tests before merging
- Commit message format (Conventional Commits)
- GitHub branch protection setup for `main`

**Short version:** branch off `main` → make changes → run `npm test` → open a PR → merge.

---

## License

MIT
