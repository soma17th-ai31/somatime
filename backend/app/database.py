from __future__ import annotations

import os
import sqlite3
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("SOMAMEET_DB_PATH", BACKEND_DIR / "somameet.db"))


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                daily_start_time TEXT NOT NULL,
                daily_end_time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                target_participants INTEGER NOT NULL,
                location_type TEXT NOT NULL,
                selected_candidate TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS participants (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                nickname TEXT NOT NULL,
                source_type TEXT NOT NULL,
                confirmed INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                UNIQUE (meeting_id, nickname)
            );

            CREATE TABLE IF NOT EXISTS availability_blocks (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                participant_id TEXT NOT NULL,
                block_type TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT NOT NULL,
                source_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
            );
            """
        )


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return dict(row)
