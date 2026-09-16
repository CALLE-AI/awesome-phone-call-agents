"""add emergency_notifications outbox table

Revision ID: 20260816_0001
Revises: 20260814_0001
Create Date: 2026-08-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0001"
down_revision: Union[str, None] = "20260814_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "emergency_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("call_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("to_number", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("provider_id", sa.String(length=255), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "call_id",
            "channel",
            name="uq_emergency_notifications_call_channel",
        ),
    )
    op.create_index(
        op.f("ix_emergency_notifications_id"),
        "emergency_notifications",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_emergency_notifications_call_id"),
        "emergency_notifications",
        ["call_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_emergency_notifications_patient_id"),
        "emergency_notifications",
        ["patient_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_emergency_notifications_status"),
        "emergency_notifications",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_emergency_notifications_provider_id"),
        "emergency_notifications",
        ["provider_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_emergency_notifications_provider_id"),
        table_name="emergency_notifications",
    )
    op.drop_index(
        op.f("ix_emergency_notifications_status"),
        table_name="emergency_notifications",
    )
    op.drop_index(
        op.f("ix_emergency_notifications_patient_id"),
        table_name="emergency_notifications",
    )
    op.drop_index(
        op.f("ix_emergency_notifications_call_id"),
        table_name="emergency_notifications",
    )
    op.drop_index(
        op.f("ix_emergency_notifications_id"),
        table_name="emergency_notifications",
    )
    op.drop_table("emergency_notifications")
