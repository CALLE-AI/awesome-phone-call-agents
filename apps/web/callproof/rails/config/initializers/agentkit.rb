# frozen_string_literal: true

require "agentkit"

Agentkit.configure do |config|
  config.domain_name    = "CallProof"
  config.primary_entity = :entity
  config.multi_tenant   = false

  # ─── Models ────────────────────────────────────────────────────────────────
  # Fake is the safe default: a fresh checkout never calls an external model.
  # Live environments must opt in explicitly.
  config.llm.adapter = ENV.fetch("AGENTKIT_LLM_ADAPTER", "fake").to_sym
  config.llm.profiles[:default] = Agentkit::ModelProfile.new(model: "claude-sonnet-4-6")
  config.llm.profiles[:fast]    = Agentkit::ModelProfile.new(model: "claude-haiku-4-5-20251001",
                                                             temperature: 0.2)
  config.llm.profiles[:complex] = Agentkit::ModelProfile.new(model: "claude-opus-4-6",
                                                             fallback: :default)

  # ─── Memory: storing and vectorising are two decisions ─────────────────────
  # level:  :off | :log | :keyword | :hybrid | :semantic | :full
  #   :keyword gives real retrieval with ZERO provider calls.
  config.memory.level = :hybrid
  # policy: :never | :immediate | :batched | :lazy | :on_promotion | :sampled | :manual
  #   :on_promotion only embeds what gets promoted (insights, repeatedly
  #   recalled, high importance) — usually an order of magnitude cheaper.
  config.memory.embedding.policy = :on_promotion
  config.memory.embedding.dedupe = true
  config.memory.query.cache      = true
  # config.memory.budget.embeddings_per_day = { tenant: 5_000 }
  # config.memory.budget.on_exceeded = :degrade   # keep serving in keyword mode

  # ─── Human in the loop ─────────────────────────────────────────────────────
  config.hitl.level = :strict        # :strict | :advisory | :silent

  # ─── Telemetry: on from day 0, otherwise the factory has nothing to read ───
  config.telemetry.enabled  = true
  config.telemetry.backends = [ :db ]

  # ─── Factory: observe only until you have data ─────────────────────────────
  config.factory.mode = :observe     # :observe | :suggest | :auto_n1 | :auto_n1_n2
end

# What happens when a suggestion is approved. v0.1 had no such hook, so every
# project monkeypatched an after_commit onto the suggestion model.
# Agentkit::HITL.on("my_suggestion_type") { |s| MyService.call(s.payload) }

# Capabilities register on every code load, so edits under app/capabilities/
# take effect without a restart in development.
# Rails.application.config.to_prepare { ExampleCapability.register_all }
