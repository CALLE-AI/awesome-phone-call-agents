"""change embedding vectors from OpenAI 1536 to MiniLM 384 dimensions

Revision ID: 20260814_0001
Revises: ca22601e5300
Create Date: 2026-08-14
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260814_0001"
down_revision: Union[str, None] = "ca22601e5300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Vectors from models with different dimensions are not compatible.
    # Clear any old OpenAI embeddings before changing the vector type.
    op.execute("DROP INDEX IF EXISTS ix_patient_embeddings_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_call_embeddings_embedding_hnsw")
    op.execute("TRUNCATE TABLE patient_embeddings, call_embeddings")

    op.execute(
        "ALTER TABLE patient_embeddings "
        "ALTER COLUMN embedding TYPE vector(384)"
    )
    op.execute(
        "ALTER TABLE call_embeddings "
        "ALTER COLUMN embedding TYPE vector(384)"
    )

    op.execute(
        "CREATE INDEX ix_patient_embeddings_embedding_hnsw "
        "ON patient_embeddings USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX ix_call_embeddings_embedding_hnsw "
        "ON call_embeddings USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_patient_embeddings_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_call_embeddings_embedding_hnsw")
    op.execute("TRUNCATE TABLE patient_embeddings, call_embeddings")

    op.execute(
        "ALTER TABLE patient_embeddings "
        "ALTER COLUMN embedding TYPE vector(1536)"
    )
    op.execute(
        "ALTER TABLE call_embeddings "
        "ALTER COLUMN embedding TYPE vector(1536)"
    )

    op.execute(
        "CREATE INDEX ix_patient_embeddings_embedding_hnsw "
        "ON patient_embeddings USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX ix_call_embeddings_embedding_hnsw "
        "ON call_embeddings USING hnsw (embedding vector_cosine_ops)"
    )
