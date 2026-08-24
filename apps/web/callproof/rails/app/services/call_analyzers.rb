# frozen_string_literal: true

module CallAnalyzers
  class << self
    def current
      case ENV.fetch("CALLPROOF_ANALYZER_ADAPTER", "fake")
      when "fake" then Fake.new
      when "http" then Http.new
      else raise ArgumentError, "Unsupported CALLPROOF_ANALYZER_ADAPTER"
      end
    end
  end
end
