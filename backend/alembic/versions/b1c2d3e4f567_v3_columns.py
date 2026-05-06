"""v3 columns: date_mode / candidate_dates / offline_buffer / pin / confirmed_share_message

Revision ID: b1c2d3e4f567
Revises: 03f766d71692
Create Date: 2026-05-06 18:00:00.000000

Adds the v3 (2026-05-06) decisions:
- meetings.date_mode VARCHAR(8) NOT NULL DEFAULT 'range' (Q5)
- meetings.candidate_dates JSON NULL (Q5)
- meetings.offline_buffer_minutes INTEGER NOT NULL DEFAULT 30 (Q8)
- meetings.confirmed_share_message TEXT NULL (Q9)
- meetings.date_range_start / date_range_end now NULLABLE (Q5)
- participants.pin VARCHAR(8) NULL (Q7)
- migrate any existing source_type='google' rows to 'manual' (Q3 cleanup)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f567"
down_revision: Union[str, None] = "03f766d71692"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "date_mode",
                sa.String(length=8),
                nullable=False,
                server_default="range",
            )
        )
        batch_op.add_column(
            sa.Column("candidate_dates", sa.JSON(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "offline_buffer_minutes",
                sa.Integer(),
                nullable=False,
                server_default="30",
            )
        )
        batch_op.add_column(
            sa.Column("confirmed_share_message", sa.Text(), nullable=True)
        )
        batch_op.alter_column(
            "date_range_start", existing_type=sa.Date(), nullable=True
        )
        batch_op.alter_column(
            "date_range_end", existing_type=sa.Date(), nullable=True
        )

    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pin", sa.String(length=8), nullable=True))

    # Backfill: migrate any 'google' source_type rows to 'manual' (Q3).
    op.execute(
        "UPDATE participants SET source_type = 'manual' "
        "WHERE source_type = 'google'"
    )


def downgrade() -> None:
    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.drop_column("pin")

    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.alter_column(
            "date_range_end", existing_type=sa.Date(), nullable=False
        )
        batch_op.alter_column(
            "date_range_start", existing_type=sa.Date(), nullable=False
        )
        batch_op.drop_column("confirmed_share_message")
        batch_op.drop_column("offline_buffer_minutes")
        batch_op.drop_column("candidate_dates")
        batch_op.drop_column("date_mode")
