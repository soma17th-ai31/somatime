"""allow empty title (issue #23)

Revision ID: f5678901234a
Revises: e4f567890123
Create Date: 2026-05-10 00:00:00.000000

Permits creating a meeting with no title. The Pydantic schema now accepts
the empty string (min_length removed) and the ORM column gains a server-side
default of '' so newly inserted rows that omit title still satisfy NOT NULL.
The column itself stays NOT NULL — empty title is stored as the empty string,
not as NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f5678901234a"
down_revision: Union[str, None] = "e4f567890123"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.alter_column(
            "title",
            existing_type=sa.String(length=200),
            existing_nullable=False,
            server_default="",
        )


def downgrade() -> None:
    with op.batch_alter_table("meetings", schema=None) as batch_op:
        batch_op.alter_column(
            "title",
            existing_type=sa.String(length=200),
            existing_nullable=False,
            server_default=None,
        )
