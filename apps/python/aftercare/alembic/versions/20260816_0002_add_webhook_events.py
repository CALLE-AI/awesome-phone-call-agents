"""add webhook_events idempotency table

Revision ID: 20260816_0002
Revises: 20260816_0001
Create Date: 2026-08-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0002"
down_revision: Union[str, None] = "20260816_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhook_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("call_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_webhook_events_id"),
        "webhook_events",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_webhook_events_event_id"),
        "webhook_events",
        ["event_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_webhook_events_event_type"),
        "webhook_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_webhook_events_call_id"),
        "webhook_events",
        ["call_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_webhook_events_status"),
        "webhook_events",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_webhook_events_status"), table_name="webhook_events")
    op.drop_index(op.f("ix_webhook_events_call_id"), table_name="webhook_events")
    op.drop_index(op.f("ix_webhook_events_event_type"), table_name="webhook_events")
    op.drop_index(op.f("ix_webhook_events_event_id"), table_name="webhook_events")
    op.drop_index(op.f("ix_webhook_events_id"), table_name="webhook_events")
    op.drop_table("webhook_events")
