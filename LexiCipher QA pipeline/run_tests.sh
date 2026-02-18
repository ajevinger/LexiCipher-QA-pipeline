#!/usr/bin/env bash
# ==============================================================================
# LexiCipher Bot Pipeline Orchestrator
#
# Generates synthetic reader bots with random cognitive traits,
# runs them in Docker containers against LexiCipher.org, and
# tracks results in a bot registry + CSV summary.
#
# Usage:
#   ./run_tests.sh [NUM_RUNS]              # Run N bots with random traits (default: 100)
#   ./run_tests.sh --parallel [NUM_RUNS]   # Run N bots with parallelism (default: 100)
#   ./run_tests.sh --replay BOT_042        # Replay a specific bot from registry
#
# Output:
#   test_reports/summary.csv               # CSV log of all runs
#   test_reports/votes_<TEST_ID>.json      # Per-run vote data
#   test_reports/REPORT_<TEST_ID>/         # Downloaded files per run
#   test_reports/dashboard_data.js         # Auto-generated data for dashboard
#   bot_registry.json                      # Persistent bot identity database
# ==============================================================================

set -euo pipefail

IMAGE_NAME="lexicipher-bot"
REPORT_DIR="$(pwd)/test_reports"
ERROR_LOG="${REPORT_DIR}/error_log.txt"
SUMMARY_CSV="${REPORT_DIR}/summary.csv"
REGISTRY="$(pwd)/bot_registry.json"
DASHBOARD_DATA="${REPORT_DIR}/dashboard_data.js"

# Max concurrent Docker containers in parallel mode
MAX_PARALLEL="${MAX_PARALLEL:-4}"
# Max retries for a failed run before marking as failed
MAX_RETRIES="${MAX_RETRIES:-1}"

VIEWPORTS=("390x844" "768x1024" "1366x768" "1920x1080" "2560x1440")
USER_TYPES=("child" "teen" "adult")

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

# Generate four random floats between 0.00 and 1.00 in a single awk call.
# Returns them space-separated: "0.42 0.87 0.13 0.65"
# Using a single awk invocation avoids same-nanosecond seed collisions that
# occur when rand_float() is called four times in rapid succession.
rand_four_floats() {
  awk "BEGIN{
    srand($(date +%s%N 2>/dev/null || date +%s)$(( RANDOM * RANDOM )));
    printf \"%.2f %.2f %.2f %.2f\", rand(), rand(), rand(), rand()
  }"
}

# Get the next BOT_ID from registry
next_bot_id() {
  if [ ! -f "$REGISTRY" ]; then
    echo "BOT_001"
    return
  fi
  local last_num
  last_num=$(python3 -c "
import json, sys
try:
    with open('$REGISTRY') as f:
        data = json.load(f)
    if data.get('bots'):
        nums = [int(b['botId'].replace('BOT_','')) for b in data['bots']]
        print(max(nums))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")
  printf "BOT_%03d" $((last_num + 1))
}

# Initialize registry if it doesn't exist
init_registry() {
  if [ ! -f "$REGISTRY" ]; then
    echo '{"bots":[],"totalRuns":0,"lastUpdated":""}' > "$REGISTRY"
  fi
}

# Add a bot entry to the registry (status: running)
register_bot() {
  local bot_id="$1" test_id="$2" user_type="$3" grade_level="$4"
  local viewport="$5" v_cr="$6" v_sa="$7" v_co="$8" v_at="$9"

  python3 -c "
import json, sys
from datetime import datetime

with open('$REGISTRY') as f:
    data = json.load(f)

bot = {
    'botId': '$bot_id',
    'testId': '$test_id',
    'createdAt': datetime.utcnow().isoformat() + 'Z',
    'traits': {
        'crowding': $v_cr,
        'saccadic': $v_sa,
        'contrast': $v_co,
        'attention': $v_at
    },
    'userType': '$user_type',
    'gradeLevel': '$grade_level',
    'viewport': '$viewport',
    'status': 'running',
    'fineTuneTriggered': None,
    'significantFactorCount': 0,
    'significantFactors': []
}

data['bots'].append(bot)
data['totalRuns'] = len(data['bots'])
data['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

with open('$REGISTRY', 'w') as f:
    json.dump(data, f, indent=2)
"
}

# Update bot status after run completes
update_bot_status() {
  local bot_id="$1" status="$2" test_id="$3"

  python3 -c "
import json, os
from datetime import datetime

with open('$REGISTRY') as f:
    data = json.load(f)

# Find the bot and update
for bot in data['bots']:
    if bot['botId'] == '$bot_id':
        bot['status'] = '$status'

        # Try to read vote log for diagnostic data
        vote_file = os.path.join('$REPORT_DIR', 'votes_$test_id.json')
        if os.path.exists(vote_file):
            with open(vote_file) as vf:
                votes = json.load(vf)
            bot['fineTuneTriggered'] = votes.get('fineTuneTriggered', False)
            bot['significantFactorCount'] = votes.get('significantFactorCount', 0)
            bot['significantFactors'] = votes.get('significantFactors', [])
        break

data['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

with open('$REGISTRY', 'w') as f:
    json.dump(data, f, indent=2)
"
}

# Read bot traits from registry for replay
read_bot_traits() {
  local bot_id="$1"
  python3 -c "
import json, sys

with open('$REGISTRY') as f:
    data = json.load(f)

for bot in data['bots']:
    if bot['botId'] == '$bot_id':
        t = bot['traits']
        print(f\"{bot['userType']} {bot.get('gradeLevel','none')} {bot['viewport']} {t['crowding']} {t['saccadic']} {t['contrast']} {t['attention']}\")
        sys.exit(0)

print('NOT_FOUND', file=sys.stderr)
sys.exit(1)
"
}

# Generate dashboard_data.js for the HTML dashboard
# Reads from bot_registry.json + summary.csv, and enriches with SQLite version data if available.
generate_dashboard_data() {
  python3 -c "
import json, os, sqlite3

registry_path = '$REGISTRY'
summary_path = '$SUMMARY_CSV'
db_path = os.path.join(os.path.dirname('$REGISTRY'), 'bot_data.db')

registry = {'bots': [], 'totalRuns': 0}
if os.path.exists(registry_path):
    with open(registry_path) as f:
        registry = json.load(f)

summary_rows = []
if os.path.exists(summary_path):
    with open(summary_path) as f:
        lines = f.readlines()
    if len(lines) > 1:
        headers = lines[0].strip().split(',')
        for line in lines[1:]:
            vals = line.strip().split(',')
            if len(vals) == len(headers):
                summary_rows.append(dict(zip(headers, vals)))

# Enrich registry bots with version data from SQLite (if available)
db_stats = {'totalRuns': 0, 'fineTuneRate': 0, 'appVersions': [], 'matrixHashes': []}
if os.path.exists(db_path):
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        # Enrich each bot with appVersion and doeMatrixHash from DB
        test_id_map = {}
        rows = conn.execute('SELECT test_id, app_version, doe_matrix_hash FROM bots').fetchall()
        for row in rows:
            test_id_map[row['test_id']] = {
                'appVersion': row['app_version'],
                'doeMatrixHash': row['doe_matrix_hash'],
            }
        for bot in registry.get('bots', []):
            tid = bot.get('testId')
            if tid and tid in test_id_map:
                bot['appVersion'] = test_id_map[tid]['appVersion']
                bot['doeMatrixHash'] = test_id_map[tid]['doeMatrixHash']

        # Aggregate stats
        total = conn.execute('SELECT COUNT(*) FROM bots').fetchone()[0]
        ft = conn.execute('SELECT COUNT(*) FROM bots WHERE fine_tune_triggered=1').fetchone()[0]
        versions = [r[0] for r in conn.execute(
            'SELECT DISTINCT app_version FROM bots WHERE app_version IS NOT NULL ORDER BY app_version'
        ).fetchall()]
        hashes = [r[0] for r in conn.execute(
            'SELECT DISTINCT doe_matrix_hash FROM bots WHERE doe_matrix_hash IS NOT NULL ORDER BY doe_matrix_hash'
        ).fetchall()]
        db_stats = {
            'totalRuns': total,
            'fineTuneRate': round(ft / total, 3) if total > 0 else 0,
            'appVersions': versions,
            'matrixHashes': hashes,
        }
        conn.close()
    except Exception as e:
        print(f'[WARN] SQLite enrichment failed: {e}')

output = '// Auto-generated by run_tests.sh — do not edit manually\n'
output += f'const REGISTRY_DATA = {json.dumps(registry, indent=2)};\n'
output += f'const SUMMARY_DATA = {json.dumps(summary_rows, indent=2)};\n'
output += f'const DB_STATS = {json.dumps(db_stats, indent=2)};\n'

with open('$DASHBOARD_DATA', 'w') as f:
    f.write(output)

print(f'Dashboard data written: {len(registry.get(\"bots\",[]))} bots, {len(summary_rows)} summary rows, {len(db_stats[\"appVersions\"])} app versions')
"
}

# Run a single bot with retry logic.
# Usage: run_bot_with_retry <run_index> <bot_id> <test_id> <vp_w> <vp_h> <ut> <gl> <v_cr> <v_sa> <v_co> <v_at>
# Writes result to SUMMARY_CSV and updates registry.
run_bot_with_retry() {
  local i="$1" BOT_ID="$2" TEST_ID="$3"
  local VP_W="$4" VP_H="$5" UT="$6" GL="$7"
  local V_CR="$8" V_SA="$9" V_CO="${10}" V_AT="${11}"
  local VP="${VP_W}x${VP_H}"

  local EXIT_CODE=0
  local DURATION=0
  local attempt

  for attempt in $(seq 1 $((MAX_RETRIES + 1))); do
    START_T=$(date +%s)

    docker run --rm \
      -e TEST_ID="${TEST_ID}" \
      -e BOT_ID="${BOT_ID}" \
      -e VIEWPORT_W="${VP_W}" \
      -e VIEWPORT_H="${VP_H}" \
      -e USER_TYPE="${UT}" \
      -e GRADE_LEVEL="${GL}" \
      -e V_CROWDING="${V_CR}" \
      -e V_SACCADIC="${V_SA}" \
      -e V_CONTRAST="${V_CO}" \
      -e V_ATTENTION="${V_AT}" \
      -v "${REPORT_DIR}:/app/downloads" \
      "${IMAGE_NAME}" \
      && EXIT_CODE=0 || EXIT_CODE=$?

    END_T=$(date +%s)
    DURATION=$(( END_T - START_T ))

    if [ "${EXIT_CODE}" -eq 0 ]; then
      break
    fi

    if [ "${attempt}" -le "${MAX_RETRIES}" ]; then
      echo "[RETRY] ${BOT_ID} attempt ${attempt}/${MAX_RETRIES} failed (exit=${EXIT_CODE}), retrying..."
    fi
  done

  # Update registry and CSV
  if [ "${EXIT_CODE}" -eq 0 ]; then
    update_bot_status "${BOT_ID}" "completed" "${TEST_ID}"
    echo "[DONE] ${BOT_ID} ✅ (${DURATION}s)"

    # Import vote log into SQLite database
    VOTE_LOG="${REPORT_DIR}/votes_${TEST_ID}.json"
    if [ -f "${VOTE_LOG}" ]; then
      python3 "$(pwd)/import_to_db.py" "${VOTE_LOG}" 2>&1 || \
        echo "[WARN] SQLite import failed for ${TEST_ID} (non-fatal)"
    fi
  else
    update_bot_status "${BOT_ID}" "failed" "${TEST_ID}"
    echo "[DONE] ${BOT_ID} ❌ exit=${EXIT_CODE} (${DURATION}s)" | tee -a "${ERROR_LOG}"
  fi

  # Append to CSV (use file lock via temp file to avoid concurrent write corruption)
  local csv_line="${i},${BOT_ID},${TEST_ID},${UT},${VP},${V_CR},${V_SA},${V_CO},${V_AT},${EXIT_CODE},${DURATION}"
  (
    flock -x 200
    echo "${csv_line}" >> "${SUMMARY_CSV}"
  ) 200>"${SUMMARY_CSV}.lock"

  return "${EXIT_CODE}"
}

# ==============================================================================
# REPLAY MODE
# ==============================================================================

if [ "${1:-}" = "--replay" ]; then
  REPLAY_BOT="${2:?Usage: $0 --replay BOT_XXX}"
  echo "[REPLAY] Looking up ${REPLAY_BOT} in registry..."

  TRAITS=$(read_bot_traits "$REPLAY_BOT")
  if [ $? -ne 0 ]; then
    echo "[ERROR] Bot ${REPLAY_BOT} not found in registry"
    exit 1
  fi

  read -r UT GL VP V_CR V_SA V_CO V_AT <<< "$TRAITS"
  VP_W="${VP%x*}"
  VP_H="${VP#*x}"

  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  TEST_ID="${TIMESTAMP}_replay"
  BOT_ID="${REPLAY_BOT}_replay"

  echo "[REPLAY] ${REPLAY_BOT}: UT=${UT} VP=${VP} CR=${V_CR} SA=${V_SA} CO=${V_CO} AT=${V_AT}"

  mkdir -p "${REPORT_DIR}"

  docker run --rm \
    -e TEST_ID="${TEST_ID}" \
    -e BOT_ID="${BOT_ID}" \
    -e VIEWPORT_W="${VP_W}" \
    -e VIEWPORT_H="${VP_H}" \
    -e USER_TYPE="${UT}" \
    -e GRADE_LEVEL="${GL}" \
    -e V_CROWDING="${V_CR}" \
    -e V_SACCADIC="${V_SA}" \
    -e V_CONTRAST="${V_CO}" \
    -e V_ATTENTION="${V_AT}" \
    -v "${REPORT_DIR}:/app/downloads" \
    "${IMAGE_NAME}" \
    && echo "[REPLAY] ✅ Success" || echo "[REPLAY] ❌ Failed"

  generate_dashboard_data
  exit 0
fi

# ==============================================================================
# PARALLEL MODE
# ==============================================================================

PARALLEL_MODE=false
if [ "${1:-}" = "--parallel" ]; then
  PARALLEL_MODE=true
  shift
fi

# ==============================================================================
# MAIN BATCH MODE
# ==============================================================================

NUM_RUNS="${1:-100}"

echo "============================================"
echo "  LexiCipher Bot Pipeline"
echo "  Runs:     ${NUM_RUNS}"
echo "  Image:    ${IMAGE_NAME}"
echo "  Parallel: ${PARALLEL_MODE} (max ${MAX_PARALLEL} concurrent)"
echo "  Retries:  ${MAX_RETRIES} per bot"
echo "============================================"

# Build the Docker image
echo "[BUILD] Building Docker image..."
docker build -t "${IMAGE_NAME}" .
echo "[BUILD] Done"

# Create report directory and CSV header
mkdir -p "${REPORT_DIR}"
if [ ! -f "${SUMMARY_CSV}" ]; then
  echo "run,bot_id,test_id,user_type,viewport,v_crowding,v_saccadic,v_contrast,v_attention,exit_code,duration_s" > "${SUMMARY_CSV}"
fi

# Initialize registry
init_registry

# Main loop
PASSED=0
FAILED=0

# Collect all bot configs upfront so BOT_IDs are sequential
declare -a BOT_CONFIGS=()

for i in $(seq 1 "${NUM_RUNS}"); do
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  TEST_ID="${TIMESTAMP}_$(printf '%03d' $i)"
  BOT_ID=$(next_bot_id)

  # Random viewport
  VP_IDX=$(( RANDOM % ${#VIEWPORTS[@]} ))
  VP="${VIEWPORTS[$VP_IDX]}"
  VP_W="${VP%x*}"
  VP_H="${VP#*x}"

  # Random user type
  UT_IDX=$(( RANDOM % ${#USER_TYPES[@]} ))
  UT="${USER_TYPES[$UT_IDX]}"

  # Grade level based on user type
  case "${UT}" in
    child) GL=$(( RANDOM % 4 + 3 )) ;;   # 3-6 (elementary)
    teen)  GL=$(( RANDOM % 4 + 7 )) ;;   # 7-10 (middle/high, no overlap with child)
    adult) GL="none" ;;
  esac

  # Generate all 4 cognitive traits in a single awk call (avoids seed collision)
  read -r V_CR V_SA V_CO V_AT <<< "$(rand_four_floats)"

  # Register bot before running
  register_bot "${BOT_ID}" "${TEST_ID}" "${UT}" "${GL}" "${VP}" "${V_CR}" "${V_SA}" "${V_CO}" "${V_AT}"

  BOT_CONFIGS+=("${i}|${BOT_ID}|${TEST_ID}|${VP_W}|${VP_H}|${UT}|${GL}|${V_CR}|${V_SA}|${V_CO}|${V_AT}")
  echo "[QUEUED] ${BOT_ID} | VP=${VP} UT=${UT} GL=${GL} | CR=${V_CR} SA=${V_SA} CO=${V_CO} AT=${V_AT}"
done

echo ""
echo "[START] Launching ${NUM_RUNS} bots..."

if [ "${PARALLEL_MODE}" = true ]; then
  # ---- PARALLEL EXECUTION ----
  # Use a job-slot semaphore: keep at most MAX_PARALLEL background jobs running.
  active_jobs=0

  for config in "${BOT_CONFIGS[@]}"; do
    IFS='|' read -r i BOT_ID TEST_ID VP_W VP_H UT GL V_CR V_SA V_CO V_AT <<< "${config}"
    echo ""
    echo "[RUN ${i}/${NUM_RUNS}] ${BOT_ID} (parallel)"

    (
      run_bot_with_retry "${i}" "${BOT_ID}" "${TEST_ID}" \
        "${VP_W}" "${VP_H}" "${UT}" "${GL}" \
        "${V_CR}" "${V_SA}" "${V_CO}" "${V_AT}"
    ) &

    active_jobs=$(( active_jobs + 1 ))

    # Throttle: wait for a slot to free up
    if [ "${active_jobs}" -ge "${MAX_PARALLEL}" ]; then
      wait -n 2>/dev/null || wait  # wait -n requires bash 4.3+; fallback to wait all
      active_jobs=$(( active_jobs - 1 ))
    fi
  done

  # Wait for all remaining jobs
  wait

else
  # ---- SEQUENTIAL EXECUTION ----
  for config in "${BOT_CONFIGS[@]}"; do
    IFS='|' read -r i BOT_ID TEST_ID VP_W VP_H UT GL V_CR V_SA V_CO V_AT <<< "${config}"
    echo ""
    echo "[RUN ${i}/${NUM_RUNS}] ${BOT_ID} | VP=${VP_W}x${VP_H} UT=${UT} GL=${GL} | CR=${V_CR} SA=${V_SA} CO=${V_CO} AT=${V_AT}"

    if run_bot_with_retry "${i}" "${BOT_ID}" "${TEST_ID}" \
        "${VP_W}" "${VP_H}" "${UT}" "${GL}" \
        "${V_CR}" "${V_SA}" "${V_CO}" "${V_AT}"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done
fi

# Tally results from CSV (works for both sequential and parallel)
if [ -f "${SUMMARY_CSV}" ]; then
  PASSED=$(tail -n +2 "${SUMMARY_CSV}" | awk -F',' '$10 == "0"' | wc -l | tr -d ' ')
  FAILED=$(tail -n +2 "${SUMMARY_CSV}" | awk -F',' '$10 != "0"' | wc -l | tr -d ' ')
fi

# Generate dashboard data
generate_dashboard_data

# Print summary
echo ""
echo "========================================="
echo "  PIPELINE COMPLETE"
echo "  Total: ${NUM_RUNS}  Passed: ${PASSED}  Failed: ${FAILED}"
echo "  Reports: ${REPORT_DIR}"
echo "  Registry: ${REGISTRY}"
echo "  Dashboard: Open dashboard.html in a browser"
echo "========================================="
