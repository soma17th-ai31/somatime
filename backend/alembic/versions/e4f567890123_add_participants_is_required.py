"""add participants.is_required (v3.11 — mandatory attendees)

Revision ID: e4f567890123
Revises: d3e4f5678901
Create Date: 2026-05-07 11:00:00.000000

Lets a participant self-mark as a required attendee (e.g. a mentor for a
special lecture). The /recommend endpoint then promotes any window where
all required participants are available, even if some non-required ones
are missing — partial-match becomes acceptable as long as the mandatory
nicknames are in.

Default is False so existing rows + future inserts behave like before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e4f567890123"
down_revision: Union[str, None] = "d3e4f5678901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("participants", schema=None) as batch_op:
        batch_op.drop_column("is_required")
