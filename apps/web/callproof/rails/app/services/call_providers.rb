# frozen_string_literal: true

module CallProviders
  class UnsupportedProvider < StandardError; end

  module_function

  def current
    name = ENV.fetch("CALLPROOF_CALL_PROVIDER", "fake")
    return Fake.new if name == "fake"
    return Calle.new if name == "calle"

    raise UnsupportedProvider, "Call provider #{name.inspect} is not implemented"
  end
end
