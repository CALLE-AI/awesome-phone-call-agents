# frozen_string_literal: true

# This migration comes from agentkit (originally 1)
class CreateAgentkitMemories < ActiveRecord::Migration[7.1]
  def change
    enable_extension "pgcrypto" unless extension_enabled?("pgcrypto")
    enable_extension "pg_trgm"  unless extension_enabled?("pg_trgm")
    # pgvector is optional: without it the memory layer runs at :keyword level,
    # which is a real retrieval mode, not a degraded one.
    enable_extension "vector" if vector_available? && !extension_enabled?("vector")

    create_table :agentkit_memories do |t|
      t.text    :content, null: false
      t.string  :memory_type, null: false, default: "observation"
      t.string  :status,      null: false, default: "raw"
      t.float   :confidence,  null: false, default: 0.7
      t.float   :importance,  null: false, default: 0.5
      t.jsonb   :tags,        null: false, default: []
      t.string  :role
      t.string  :source_agent

      t.bigint  :user_id
      t.bigint  :account_id
      t.string  :tenant_key

      # Embedding is a separate decision from storage — this is the column set
      # that makes it configurable instead of unconditional.
      t.string  :embedding_status, null: false, default: "none"
      t.string  :embedding_model
      t.integer :embedding_dims
      t.string  :content_hash
      t.bigint  :duplicate_of_id

      t.integer  :recall_count, null: false, default: 0
      t.datetime :last_recalled_at
      t.datetime :promoted_at

      t.bigint  :derived_from_memory_id   # council: fact → role interpretations
      t.bigint  :canonical_memory_id      # hub-and-spoke retrieval entry points
      t.bigint  :superseded_by_id         # non-destructive consolidation

      t.string  :ontological_type, null: false, default: "real"
      t.uuid    :run_id
      t.datetime :expires_at
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    # Explicit SQL: `add_column ..., :vector, limit:` does not always carry the
    # dimensions through, and a dimensionless vector column cannot be indexed.
    if vector_available?
      dims = 1536
      execute "ALTER TABLE agentkit_memories ADD COLUMN embedding vector(#{dims});"
    else
      say "pgvector not available: skipping the embedding column, memory runs at :keyword level", true
    end

    # Keyword retrieval path — what makes `level: :keyword` a real mode with
    # zero provider calls rather than "memory disabled".
    execute <<~SQL
      ALTER TABLE agentkit_memories
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;
    SQL

    add_index :agentkit_memories, :search_vector, using: :gin
    add_index :agentkit_memories, :content, using: :gin, opclass: :gin_trgm_ops
    add_index :agentkit_memories, :tags, using: :gin
    add_index :agentkit_memories, %i[tenant_key status]
    add_index :agentkit_memories, %i[account_id memory_type]
    add_index :agentkit_memories, :derived_from_memory_id
    add_index :agentkit_memories, :superseded_by_id
    add_index :agentkit_memories, :ontological_type
    add_index :agentkit_memories, :expires_at
    add_index :agentkit_memories, %i[content_hash tenant_key],
              unique: true, where: "embedding_status = 'embedded'",
              name: "idx_agentkit_memories_dedupe"

    return unless vector_available?

    # Partial HNSW: under :on_promotion most rows carry no vector, so the index
    # only covers the ones that do. Keeps recall latency flat as the table grows.
    execute <<~SQL
      CREATE INDEX IF NOT EXISTS idx_agentkit_memories_embedding
      ON agentkit_memories USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL;
    SQL
  end

  private

  # Checked rather than rescued: a blanket `rescue` inside a migration swallows
  # the real error AND leaves the transaction aborted, so every later migration
  # fails with a misleading "current transaction is aborted".
  def vector_available?
    return @vector_available unless @vector_available.nil?

    @vector_available =
      select_value("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'").present? &&
      defined?(::Pgvector)
  end
end
