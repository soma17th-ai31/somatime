"""drop meetings.offline_buffer_minutes (issue #13 follow-up)

Revision ID: h7890123456c
Revises: g6789012345b
Create Date: 2026-05-11 07:00:00.000000

The meeting-level offline buffer is being retired in favour of the
per-participant ``participants.buffer_minutes`` column (added in
g6789012345b). To preserve each existing user's effective buffer, we first
back-fill any NULL participant buffer with their meeting's current
``offline_buffer_minutes`` value, then drop the column from ``meetings``.

The back-fill is dialect-agnostic — we read the per-meeting buffer into a
plain Python dict and issue per-meeting UPDATE statements, which works on
both SQLite (no UPDATE…FROM) and Postgres.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h7890123456c"
down_revision: Union[str, None] = "g6789012345b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Back-fill participants.buffer_minutes for rows that currently inherit
    #    the meeting default (NULL). After this, every participant has an
    #    explicit value, so the dropped column isn't load-bearing.
    rows = bind.execute(
        sa.text("SELECT id, offline_buffer_minutes FROM meetings")
    ).fetchall()
    for meeting_id, meeting_buffer in rows:
        if meeting_buffer is None:
            continue
        bind.execute(
            sa.text(
                "UPDATE participants "
                "SET buffer_minutes = :buf "
                "WHERE meeting_id = :mid AND buffer_minutes IS NULL"
            ),
            {"buf": int(meeting_buffer), "mid": meeting_id},
        )

    # 2) Drop the meeting-level column.
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.drop_column("offline_buffer_minutes")


def downgrade() -> None:
    # Restore the column with the historical default (30). The original
    # per-meeting values aren't recoverable; the back-fill is one-way.
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "offline_buffer_minutes",
                sa.Integer(),
                nullable=False,
                server_default="30",
            )
        )
