"""drop meetings.organizer_token (v3.2 Path B — share-URL only)

Revision ID: d3e4f5678901
Revises: c2d3e4f56789
Create Date: 2026-05-06 23:30:00.000000

Path B decision: organizer / participant authority split is removed.
Anyone with the share URL can run calculate / recommend / confirm. The
2-step ShareMessageDialog is the sole accident-prevention safeguard.

Downgrade re-adds the column as nullable. The historical secret cannot be
recovered, so a fresh placeholder ('') is the only honest restoration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d3e4f5678901"
down_revision: Union[str, None] = "c2d3e4f56789"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.drop_column("organizer_token")


def downgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "organizer_token",
                sa.String(length=64),
                nullable=True,
            )
        )
