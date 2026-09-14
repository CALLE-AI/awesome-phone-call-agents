# frozen_string_literal: true

# Base for every domain agent. Inherits from Agentkit::Agent:
#   chat / complete    — LLM with retry, fallback, schema and cost accounting
#   memorize! / recall! — memory honouring the configured embedding policy
#   suggest!            — HITL proposal recorded in the decision ledger
#   build_context       — system prompt assembled under a token budget
class ApplicationAgent < Agentkit::Agent
  # Injected into every system prompt. Keep it cheap: it runs on each call.
  def domain_context
    return "" unless current_account

    "Account: #{current_account.name}."
  end
end
