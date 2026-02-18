#!/usr/bin/env python3
"""
analyze.py — Pre-built analysis queries for bot_data.db

Usage:
    python3 analyze.py                          # Show summary stats
    python3 analyze.py --factors                # Factor significance rates
    python3 analyze.py --finetune-by-type       # Fine-tune rate by user type
    python3 analyze.py --votes-by-factor        # Vote distribution per factor level
    python3 analyze.py --versions               # List all app versions seen
    python3 analyze.py --bots [N]               # List last N bots (default 20)
    python3 analyze.py --replay-candidates      # Bots worth replaying (high trait, fine-tune)
    python3 analyze.py --query "SELECT ..."     # Run a raw SQL query
"""

import sys
import json
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'bot_data.db')

FACTORS = ['letter_spacing', 'word_spacing', 'line_height', 'font_weight',
           'font_size', 'paragraph_width', 'bwgt']

FACTOR_LABELS = {
    'letter_spacing':  'letterSpacing',
    'word_spacing':    'wordSpacing',
    'line_height':     'lineHeight',
    'font_weight':     'fontWeight',
    'font_size':       'fontSize',
    'paragraph_width': 'paragraphWidth',
    'bwgt':            'bwgt',
}


def get_connection():
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        print("Run some bots first, or backfill with:")
        print("  python3 import_to_db.py --backfill test_reports/")
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def fmt_pct(n, d):
    return f"{100*n/d:.1f}%" if d > 0 else "n/a"


def print_table(headers, rows, col_widths=None):
    if not rows:
        print("  (no data)")
        return
    if col_widths is None:
        col_widths = [max(len(str(h)), max(len(str(r[i])) for r in rows))
                      for i, h in enumerate(headers)]
    header_line = "  " + "  ".join(str(h).ljust(w) for h, w in zip(headers, col_widths))
    sep_line    = "  " + "  ".join("-" * w for w in col_widths)
    print(header_line)
    print(sep_line)
    for row in rows:
        print("  " + "  ".join(str(v).ljust(w) for v, w in zip(row, col_widths)))


# ============================================================
# ANALYSIS FUNCTIONS
# ============================================================

def summary(conn):
    """Overall summary statistics."""
    total = conn.execute("SELECT COUNT(*) FROM bots").fetchone()[0]
    if total == 0:
        print("No data in database yet.")
        return

    fine_tune = conn.execute("SELECT COUNT(*) FROM bots WHERE fine_tune_triggered=1").fetchone()[0]
    total_votes = conn.execute("SELECT COUNT(*) FROM votes").fetchone()[0]
    better = conn.execute("SELECT COUNT(*) FROM votes WHERE vote=1").fetchone()[0]
    same   = conn.execute("SELECT COUNT(*) FROM votes WHERE vote=0").fetchone()[0]
    worse  = conn.execute("SELECT COUNT(*) FROM votes WHERE vote=-1").fetchone()[0]

    versions = conn.execute(
        "SELECT COUNT(DISTINCT app_version) FROM bots WHERE app_version IS NOT NULL"
    ).fetchone()[0]
    matrix_hashes = conn.execute(
        "SELECT COUNT(DISTINCT doe_matrix_hash) FROM bots WHERE doe_matrix_hash IS NOT NULL"
    ).fetchone()[0]

    print("=" * 50)
    print("  LexiCipher Bot Pipeline — Summary")
    print("=" * 50)
    print(f"  Total runs:          {total}")
    print(f"  Fine-Tune triggered: {fine_tune} ({fmt_pct(fine_tune, total)})")
    print(f"  Total votes:         {total_votes}")
    print(f"  Vote distribution:   Better={better} ({fmt_pct(better, total_votes)})  "
          f"Same={same} ({fmt_pct(same, total_votes)})  "
          f"Worse={worse} ({fmt_pct(worse, total_votes)})")
    print(f"  App versions seen:   {versions}")
    print(f"  DOE matrix hashes:   {matrix_hashes}")
    print()

    # Recent runs
    recent = conn.execute("""
        SELECT bot_id, user_type, fine_tune_triggered,
               significant_factor_count, completed_at, app_version
        FROM bots ORDER BY completed_at DESC LIMIT 5
    """).fetchall()
    print("  Recent runs:")
    print_table(
        ['Bot ID', 'Type', 'FineTune', 'Sig.Factors', 'Completed', 'App Version'],
        [(r['bot_id'], r['user_type'], '✅' if r['fine_tune_triggered'] else '❌',
          r['significant_factor_count'],
          (r['completed_at'] or '')[:19],
          (r['app_version'] or 'unknown')[:20])
         for r in recent],
        [12, 6, 8, 11, 19, 22]
    )
    print()


def factor_significance(conn):
    """Which factors appear most often as significant across all runs."""
    total = conn.execute("SELECT COUNT(*) FROM bots WHERE fine_tune_triggered=1").fetchone()[0]
    if total == 0:
        print("No fine-tune runs yet.")
        return

    print("=" * 50)
    print("  Factor Significance Rates")
    print(f"  (across {total} fine-tune runs)")
    print("=" * 50)

    rows = conn.execute("""
        SELECT significant_factors FROM bots WHERE fine_tune_triggered=1
    """).fetchall()

    counts = {}
    for row in rows:
        factors = json.loads(row['significant_factors'] or '[]')
        for f in factors:
            counts[f] = counts.get(f, 0) + 1

    sorted_factors = sorted(counts.items(), key=lambda x: -x[1])
    table_rows = [(f, c, fmt_pct(c, total)) for f, c in sorted_factors]
    print_table(['Factor', 'Count', 'Rate'], table_rows, [20, 7, 8])
    print()


def finetune_by_type(conn):
    """Fine-tune trigger rate broken down by user type."""
    print("=" * 50)
    print("  Fine-Tune Rate by User Type")
    print("=" * 50)

    rows = conn.execute("""
        SELECT user_type,
               COUNT(*) as total,
               SUM(fine_tune_triggered) as triggered,
               AVG(v_crowding) as avg_crowding,
               AVG(v_saccadic) as avg_saccadic,
               AVG(v_contrast) as avg_contrast
        FROM bots
        GROUP BY user_type
        ORDER BY user_type
    """).fetchall()

    table_rows = [
        (r['user_type'], r['total'], r['triggered'],
         fmt_pct(r['triggered'], r['total']),
         f"{r['avg_crowding']:.2f}", f"{r['avg_saccadic']:.2f}", f"{r['avg_contrast']:.2f}")
        for r in rows
    ]
    print_table(
        ['Type', 'Total', 'FineTune', 'Rate', 'AvgCrowd', 'AvgSacc', 'AvgContr'],
        table_rows, [8, 7, 8, 7, 9, 8, 8]
    )
    print()


def votes_by_factor(conn):
    """Vote distribution (Better/Same/Worse) for each factor at high (+1) vs low (-1) level."""
    print("=" * 50)
    print("  Vote Distribution by Factor Level")
    print("  (Better% when factor is at high +1 vs low -1)")
    print("=" * 50)

    rows_out = []
    for col, label in FACTOR_LABELS.items():
        for level, level_label in [(1, 'High (+1)'), (-1, 'Low (-1)')]:
            r = conn.execute(f"""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) as better,
                    SUM(CASE WHEN vote=0 THEN 1 ELSE 0 END) as same,
                    SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) as worse
                FROM votes
                WHERE {col} = ?
            """, (level,)).fetchone()
            if r['total'] > 0:
                rows_out.append((
                    label, level_label,
                    r['total'],
                    fmt_pct(r['better'], r['total']),
                    fmt_pct(r['same'], r['total']),
                    fmt_pct(r['worse'], r['total']),
                ))

    print_table(
        ['Factor', 'Level', 'N', 'Better%', 'Same%', 'Worse%'],
        rows_out, [16, 10, 6, 8, 7, 7]
    )
    print()


def versions(conn):
    """List all app versions and DOE matrix hashes seen."""
    print("=" * 50)
    print("  LexiCipher App Versions Seen")
    print("=" * 50)

    rows = conn.execute("""
        SELECT app_version, doe_matrix_hash,
               COUNT(*) as runs,
               MIN(completed_at) as first_seen,
               MAX(completed_at) as last_seen
        FROM bots
        WHERE app_version IS NOT NULL
        GROUP BY app_version, doe_matrix_hash
        ORDER BY first_seen DESC
    """).fetchall()

    if not rows:
        print("  No version data yet. Run bots with the updated bot.js to capture versions.")
        return

    print_table(
        ['App Version', 'Matrix Hash', 'Runs', 'First Seen', 'Last Seen'],
        [(r['app_version'][:22], r['doe_matrix_hash'] or 'n/a',
          r['runs'],
          (r['first_seen'] or '')[:19],
          (r['last_seen'] or '')[:19])
         for r in rows],
        [24, 13, 5, 19, 19]
    )
    print()


def list_bots(conn, n=20):
    """List the most recent N bots."""
    print("=" * 50)
    print(f"  Last {n} Bot Runs")
    print("=" * 50)

    rows = conn.execute("""
        SELECT bot_id, test_id, user_type, v_crowding, v_saccadic, v_contrast, v_attention,
               fine_tune_triggered, significant_factor_count, vote_better, vote_same, vote_worse,
               app_version, completed_at
        FROM bots
        ORDER BY completed_at DESC
        LIMIT ?
    """, (n,)).fetchall()

    print_table(
        ['Bot ID', 'Type', 'Crowd', 'Sacc', 'Contr', 'Attn', 'FT', 'Sig', 'B/S/W', 'Version'],
        [(r['bot_id'], r['user_type'],
          f"{r['v_crowding']:.2f}", f"{r['v_saccadic']:.2f}",
          f"{r['v_contrast']:.2f}", f"{r['v_attention']:.2f}",
          '✅' if r['fine_tune_triggered'] else '❌',
          r['significant_factor_count'],
          f"{r['vote_better']}/{r['vote_same']}/{r['vote_worse']}",
          (r['app_version'] or 'unknown')[:20])
         for r in rows],
        [12, 6, 6, 6, 6, 6, 3, 4, 8, 22]
    )
    print()


def replay_candidates(conn):
    """Bots worth replaying: high trait values + fine-tune triggered."""
    print("=" * 50)
    print("  Replay Candidates")
    print("  (fine-tune triggered, high trait values)")
    print("=" * 50)

    rows = conn.execute("""
        SELECT bot_id, test_id, user_type,
               v_crowding, v_saccadic, v_contrast, v_attention,
               significant_factors, vote_better, vote_same, vote_worse,
               app_version
        FROM bots
        WHERE fine_tune_triggered = 1
          AND (v_crowding > 0.7 OR v_saccadic > 0.7 OR v_contrast > 0.7)
        ORDER BY (v_crowding + v_saccadic + v_contrast) DESC
        LIMIT 20
    """).fetchall()

    if not rows:
        print("  No qualifying bots yet.")
        return

    print_table(
        ['Bot ID', 'Type', 'Crowd', 'Sacc', 'Contr', 'Sig Factors', 'B/S/W'],
        [(r['bot_id'], r['user_type'],
          f"{r['v_crowding']:.2f}", f"{r['v_saccadic']:.2f}", f"{r['v_contrast']:.2f}",
          ', '.join(json.loads(r['significant_factors'] or '[]')),
          f"{r['vote_better']}/{r['vote_same']}/{r['vote_worse']}")
         for r in rows],
        [12, 6, 6, 6, 6, 30, 8]
    )
    print()
    print("  To replay: ./run_tests.sh --replay <BOT_ID>")
    print()


def raw_query(conn, sql):
    """Execute a raw SQL query and print results."""
    try:
        rows = conn.execute(sql).fetchall()
        if not rows:
            print("  (no results)")
            return
        headers = rows[0].keys()
        print_table(list(headers), [list(r) for r in rows])
    except sqlite3.Error as e:
        print(f"SQL Error: {e}")


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    conn = get_connection()

    args = sys.argv[1:]

    if not args:
        summary(conn)
        factor_significance(conn)
        finetune_by_type(conn)
    elif '--factors' in args:
        factor_significance(conn)
    elif '--finetune-by-type' in args:
        finetune_by_type(conn)
    elif '--votes-by-factor' in args:
        votes_by_factor(conn)
    elif '--versions' in args:
        versions(conn)
    elif '--bots' in args:
        idx = args.index('--bots')
        n = int(args[idx + 1]) if idx + 1 < len(args) and args[idx + 1].isdigit() else 20
        list_bots(conn, n)
    elif '--replay-candidates' in args:
        replay_candidates(conn)
    elif '--query' in args:
        idx = args.index('--query')
        if idx + 1 < len(args):
            raw_query(conn, args[idx + 1])
        else:
            print("Usage: python3 analyze.py --query \"SELECT ...\"")
    elif '--all' in args:
        summary(conn)
        factor_significance(conn)
        finetune_by_type(conn)
        votes_by_factor(conn)
        versions(conn)
    else:
        print(__doc__)

    conn.close()
