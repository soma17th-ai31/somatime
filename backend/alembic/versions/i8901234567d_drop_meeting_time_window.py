"""drop meetings.time_window_start / time_window_end (issue #57)

Revision ID: i8901234567d
Revises: h7890123456c
Create Date: 2026-05-11 08:00:00.000000

The meeting-level configurable time window is being retired. Every meeting
now shares the constant 06:00-24:00 search window defined by
``MEETING_WINDOW_START`` / ``MEETING_WINDOW_END`` in
``app.services.scheduler``.

Per the rollout decision, existing meeting rows do NOT carry forward. The
prior windows were chosen against the old UX (variable 09:00-22:00 default
plus user overrides), and keeping them would silently constrain newly
calculated candidates after the upgrade. We wipe meetings + cascade
participants + busy_blocks before dropping the columns so the new constant
window is the single source of truth from this revision forward.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "i8901234567d"
down_revision: Union[str, None] = "h7890123456c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Wipe child tables first so the meeting DELETE doesn't trip any
    # platform that lazily enforces the ON DELETE CASCADE. SQLite needs
    # ``PRAGMA foreign_keys=ON`` to honour CASCADE, and not every Postgres
    # configuration carries that pragma forward; explicit DELETE is robust.
    op.execute("DELETE FROM busy_blocks")
    op.execute("DELETE FROM participants")
    op.execute("DELETE FROM meetings")

    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.drop_column("time_window_start")
        batch_op.drop_column("time_window_end")


def downgrade() -> None:
    # Restore the historical NOT NULL columns with the original default
    # (09:00 / 22:00). Pre-existing values are unrecoverable — the upgrade
    # is one-way as far as data goes.
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "time_window_start",
                sa.Time(),
                nullable=False,
                server_default=sa.text("'09:00:00'"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "time_window_end",
                sa.Time(),
                nullable=False,
                server_default=sa.text("'22:00:00'"),
            )
        )
