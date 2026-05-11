"""add participants.buffer_minutes (issue #13 — personal travel buffer)

Revision ID: g6789012345b
Revises: f5678901234a
Create Date: 2026-05-11 06:30:00.000000

Lets a participant override the meeting-level ``offline_buffer_minutes``
with their own travel-time buffer. NULL means "use the meeting default"
so existing rows behave exactly as before this migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "g6789012345b"
down_revision: Union[str, None] = "f5678901234a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("buffer_minutes", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.drop_column("buffer_minutes")
