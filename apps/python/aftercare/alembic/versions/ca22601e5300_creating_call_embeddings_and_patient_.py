"""creating call embeddings and patient embeddings

Revision ID: ca22601e5300
Revises: 20260809_0001
Create Date: 2026-08-14 03:33:32.784349+00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "ca22601e5300"
down_revision: Union[str, None] = "20260809_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "patient_embeddings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("context_text", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id"),
    )
    op.create_index(
        op.f("ix_patient_embeddings_id"), "patient_embeddings", ["id"], unique=False
    )
    op.execute(
        "CREATE INDEX ix_patient_embeddings_embedding_hnsw "
        "ON patient_embeddings USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "call_embeddings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("call_id", sa.Integer(), nullable=False),
        sa.Column("context_text", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("call_id"),
    )
    op.create_index(
        op.f("ix_call_embeddings_id"), "call_embeddings", ["id"], unique=False
    )
    op.execute(
        "CREATE INDEX ix_call_embeddings_embedding_hnsw "
        "ON call_embeddings USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_call_embeddings_embedding_hnsw")
    op.drop_index(op.f("ix_call_embeddings_id"), table_name="call_embeddings")
    op.drop_table("call_embeddings")
    op.execute("DROP INDEX IF EXISTS ix_patient_embeddings_embedding_hnsw")
    op.drop_index(op.f("ix_patient_embeddings_id"), table_name="patient_embeddings")
    op.drop_table("patient_embeddings")
