"""drop meetings.participant_count (v3.1 simplify pass)

Revision ID: c2d3e4f56789
Revises: b1c2d3e4f567
Create Date: 2026-05-06 22:00:00.000000

The "참여 인원 (target)" input was removed from the create form. The
schedule readiness gate now flips on `submitted_count >= 1`, so the
column has no remaining reader and is safe to drop.

Downgrade re-adds the column as nullable (no historical target value
is recoverable).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c2d3e4f56789"
down_revision: Union[str, None] = "b1c2d3e4f567"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.drop_column("participant_count")


def downgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("participant_count", sa.Integer(), nullable=True)
        )
