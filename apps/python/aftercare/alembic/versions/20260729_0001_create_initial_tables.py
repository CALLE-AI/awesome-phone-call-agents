"""create initial tables

Revision ID: 20260729_0001
Revises:
Create Date: 2026-07-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260729_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("gender", sa.String(length=50), nullable=True),
        sa.Column("doctor_name", sa.String(length=255), nullable=True),
        sa.Column("doctor_contact", sa.String(length=32), nullable=True),
        sa.Column("discharge_date", sa.Date(), nullable=True),
        sa.Column("discharge_diagnosis", sa.Text(), nullable=True),
        sa.Column("current_risk_level", sa.String(length=50), nullable=False),
        sa.Column("consent_on_file", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_patients_id"), "patients", ["id"], unique=False)
    op.create_index(op.f("ix_patients_phone"), "patients", ["phone"], unique=False)

    op.create_table(
        "followups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("scheduled_time", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_followups_id"), "followups", ["id"], unique=False)
    op.create_index(
        op.f("ix_followups_patient_id"), "followups", ["patient_id"], unique=False
    )
    op.create_index(
        op.f("ix_followups_scheduled_time"),
        "followups",
        ["scheduled_time"],
        unique=False,
    )

    op.create_table(
        "calls",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("followup_id", sa.Integer(), nullable=True),
        sa.Column("calle_call_id", sa.String(length=255), nullable=True),
        sa.Column("call_start", sa.DateTime(), nullable=True),
        sa.Column("call_end", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("risk_score", sa.Float(), nullable=True),
        sa.Column("risk_level", sa.String(length=50), nullable=True),
        sa.Column("is_emergency", sa.Boolean(), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["followup_id"], ["followups.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_calls_calle_call_id"), "calls", ["calle_call_id"], unique=False)
    op.create_index(op.f("ix_calls_followup_id"), "calls", ["followup_id"], unique=False)
    op.create_index(op.f("ix_calls_id"), "calls", ["id"], unique=False)
    op.create_index(op.f("ix_calls_patient_id"), "calls", ["patient_id"], unique=False)

    op.create_table(
        "symptoms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("call_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_symptoms_call_id"), "symptoms", ["call_id"], unique=False)
    op.create_index(op.f("ix_symptoms_id"), "symptoms", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_symptoms_id"), table_name="symptoms")
    op.drop_index(op.f("ix_symptoms_call_id"), table_name="symptoms")
    op.drop_table("symptoms")

    op.drop_index(op.f("ix_calls_patient_id"), table_name="calls")
    op.drop_index(op.f("ix_calls_id"), table_name="calls")
    op.drop_index(op.f("ix_calls_followup_id"), table_name="calls")
    op.drop_index(op.f("ix_calls_calle_call_id"), table_name="calls")
    op.drop_table("calls")

    op.drop_index(op.f("ix_followups_scheduled_time"), table_name="followups")
    op.drop_index(op.f("ix_followups_patient_id"), table_name="followups")
    op.drop_index(op.f("ix_followups_id"), table_name="followups")
    op.drop_table("followups")

    op.drop_index(op.f("ix_patients_phone"), table_name="patients")
    op.drop_index(op.f("ix_patients_id"), table_name="patients")
    op.drop_table("patients")
