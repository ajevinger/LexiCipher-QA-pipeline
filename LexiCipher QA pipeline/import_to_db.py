#!/usr/bin/env python3
"""
import_to_db.py — Import a votes_*.json file into bot_data.db (SQLite)

Usage:
    python3 import_to_db.py <path_to_votes_json>
    python3 import_to_db.py test_reports/votes_smoke_pass_001.json

Called automatically by run_tests.sh after each successful bot run.
Can also be run manually to backfill existing vote logs.

Schema:
    bots  — one row per run (metadata, traits, results, version fingerprints)
    votes — one row per vote (16 per run, factor levels, penalty, vote label)
"""

import sys
import json
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'bot_data.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # Safe for concurrent writes
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def create_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS bots (
            test_id                TEXT PRIMARY KEY,
            bot_id                 TEXT NOT NULL,
            created_at             TEXT,
            completed_at           TEXT,

            -- Version fingerprints
            site_url               TEXT,
            app_version            TEXT,   -- Next.js build ID (changes per Vercel deploy)
            doe_matrix_hash        TEXT,   -- SHA-256 prefix of DOE matrix (detects structure changes)
            pipeline_version       TEXT,   -- Bot pipeline semver

            -- Bot profile
            user_type              TEXT,
            grade_level            TEXT,
            viewport               TEXT,
            v_crowding             REAL,
            v_saccadic             REAL,
            v_contrast             REAL,
            v_attention            REAL,

            -- Results
            fine_tune_triggered    INTEGER,  -- 0 or 1
            significant_factor_count INTEGER,
            significant_factors    TEXT,     -- JSON array as string
            optimization_rounds    INTEGER,
            vote_better            INTEGER,
            vote_same              INTEGER,
            vote_worse             INTEGER,
            downloaded_files       TEXT,     -- JSON array as string

            -- Error info (null on success)
            error_message          TEXT
        );

        CREATE TABLE IF NOT EXISTS votes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            test_id         TEXT NOT NULL REFERENCES bots(test_id),
            bot_id          TEXT NOT NULL,
            test_num        INTEGER,
            run_number      INTEGER,

            -- Factor levels (-1 or +1)
            letter_spacing  INTEGER,
            word_spacing    INTEGER,
            line_height     INTEGER,
            font_weight     INTEGER,
            font_size       INTEGER,
            paragraph_width INTEGER,
            bwgt            INTEGER,

            -- Scoring
            penalty         REAL,
            ref_penalty     REAL,
            noise           REAL,
            vote            INTEGER,   -- -1, 0, or 1
            vote_label      TEXT       -- 'Worse', 'Same', 'Better'
        );

        CREATE INDEX IF NOT EXISTS idx_votes_test_id  ON votes(test_id);
        CREATE INDEX IF NOT EXISTS idx_votes_vote     ON votes(vote);
        CREATE INDEX IF NOT EXISTS idx_bots_app_ver   ON bots(app_version);
        CREATE INDEX IF NOT EXISTS idx_bots_matrix    ON bots(doe_matrix_hash);
        CREATE INDEX IF NOT EXISTS idx_bots_user_type ON bots(user_type);
    """)
    conn.commit()


def import_vote_log(conn, json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    test_id = data.get('testId') or data.get('test_id')
    if not test_id:
        print(f"ERROR: No testId in {json_path}", file=sys.stderr)
        return False

    # Check for duplicate
    existing = conn.execute("SELECT test_id FROM bots WHERE test_id = ?", (test_id,)).fetchone()
    if existing:
        print(f"SKIP: {test_id} already in database")
        return True

    traits = data.get('traits', {})
    votes_data = data.get('votes', [])

    # Count vote distribution
    vote_better = sum(1 for v in votes_data if v.get('vote') == 1)
    vote_same   = sum(1 for v in votes_data if v.get('vote') == 0)
    vote_worse  = sum(1 for v in votes_data if v.get('vote') == -1)

    # Insert bot row
    conn.execute("""
        INSERT INTO bots (
            test_id, bot_id, created_at, completed_at,
            site_url, app_version, doe_matrix_hash, pipeline_version,
            user_type, grade_level, viewport,
            v_crowding, v_saccadic, v_contrast, v_attention,
            fine_tune_triggered, significant_factor_count, significant_factors,
            optimization_rounds, vote_better, vote_same, vote_worse,
            downloaded_files, error_message
        ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?
        )
    """, (
        test_id,
        data.get('botId') or data.get('bot_id', 'unknown'),
        data.get('createdAt') or data.get('completedAt'),
        data.get('completedAt'),

        data.get('siteUrl'),
        data.get('appVersion'),
        data.get('doeMatrixHash'),
        data.get('pipelineVersion'),

        data.get('userType', 'adult'),
        data.get('gradeLevel', 'none'),
        data.get('viewport', '1920x1080'),

        traits.get('crowding', 0.5),
        traits.get('saccadic', 0.5),
        traits.get('contrast', 0.5),
        traits.get('attention', 0.5),

        1 if data.get('fineTuneTriggered') else 0,
        data.get('significantFactorCount', 0),
        json.dumps(data.get('significantFactors', [])),
        data.get('optimizationRounds', 0),

        vote_better, vote_same, vote_worse,
        json.dumps(data.get('downloadedFiles', [])),
        data.get('error'),
    ))

    # Insert vote rows
    for v in votes_data:
        fl = v.get('factorLevels') or {}
        conn.execute("""
            INSERT INTO votes (
                test_id, bot_id, test_num, run_number,
                letter_spacing, word_spacing, line_height, font_weight,
                font_size, paragraph_width, bwgt,
                penalty, ref_penalty, noise, vote, vote_label
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?, ?
            )
        """, (
            test_id,
            data.get('botId', 'unknown'),
            v.get('testNum'),
            v.get('runNumber'),
            fl.get('letterSpacing'),
            fl.get('wordSpacing'),
            fl.get('lineHeight'),
            fl.get('fontWeight'),
            fl.get('fontSize'),
            fl.get('paragraphWidth'),
            fl.get('bwgt'),
            v.get('penalty'),
            v.get('refPenalty'),
            v.get('noise'),
            v.get('vote'),
            v.get('voteLabel'),
        ))

    conn.commit()
    print(f"IMPORTED: {test_id} ({len(votes_data)} votes, fine_tune={data.get('fineTuneTriggered')})")
    return True


def backfill_directory(conn, reports_dir):
    """Import all votes_*.json files from a directory."""
    if not os.path.isdir(reports_dir):
        print(f"Directory not found: {reports_dir}")
        return
    count = 0
    for fname in sorted(os.listdir(reports_dir)):
        if fname.startswith('votes_') and fname.endswith('.json'):
            path = os.path.join(reports_dir, fname)
            if import_vote_log(conn, path):
                count += 1
    print(f"Backfill complete: {count} files processed from {reports_dir}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 import_to_db.py <votes_json_path>")
        print("       python3 import_to_db.py --backfill [test_reports/]")
        sys.exit(1)

    conn = get_connection()
    create_schema(conn)

    if sys.argv[1] == '--backfill':
        reports_dir = sys.argv[2] if len(sys.argv) > 2 else 'test_reports'
        backfill_directory(conn, reports_dir)
    else:
        json_path = sys.argv[1]
        if not os.path.exists(json_path):
            print(f"ERROR: File not found: {json_path}", file=sys.stderr)
            sys.exit(1)
        success = import_vote_log(conn, json_path)
        sys.exit(0 if success else 1)

    conn.close()
