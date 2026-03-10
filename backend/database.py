"""
Groot – SQLite database models using raw sqlite3
"""
import sqlite3
import json
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "groot.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.executescript("""
    CREATE TABLE IF NOT EXISTS datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        row_count INTEGER DEFAULT 0,
        format TEXT DEFAULT 'jsonl',
        created_at TEXT NOT NULL,
        metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        dataset_id INTEGER NOT NULL,
        base_model TEXT NOT NULL,
        status TEXT DEFAULT 'queued',
        epochs INTEGER DEFAULT 3,
        learning_rate REAL DEFAULT 1e-4,
        max_seq_length INTEGER DEFAULT 512,
        batch_size INTEGER DEFAULT 4,
        iters INTEGER DEFAULT 100,
        adapter_path TEXT,
        fused_model_path TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        error_message TEXT,
        final_loss REAL,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (dataset_id) REFERENCES datasets(id)
    );

    CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        job_id INTEGER,
        base_model TEXT NOT NULL,
        adapter_path TEXT,
        fused_path TEXT,
        dataset_name TEXT,
        training_time_seconds INTEGER,
        final_loss REAL,
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'ready',
        FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    """)

    conn.commit()

    # Migrations: add columns added after initial schema
    _run_migrations(conn)

    conn.close()


def _run_migrations(conn):
    """Apply schema migrations for columns added after initial release."""
    cur = conn.cursor()
    existing_cols = {row[1] for row in cur.execute("PRAGMA table_info(jobs)")}
    if "metadata" not in existing_cols:
        cur.execute("ALTER TABLE jobs ADD COLUMN metadata TEXT DEFAULT '{}'")
        conn.commit()


def dict_from_row(row):
    if row is None:
        return None
    return dict(row)


def now_iso():
    return datetime.utcnow().isoformat()
