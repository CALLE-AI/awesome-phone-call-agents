ENV["RAILS_ENV"] ||= "test"
# Operator credentials that gate the live-call workflow. Set before the app loads
# so OperatorAuthenticated has a configured password (otherwise it fails closed).
ENV["CALLPROOF_OPERATOR_USER"] ||= "operator"
ENV["CALLPROOF_OPERATOR_PASSWORD"] ||= "test-operator-secret"
require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

module ActionDispatch
  class IntegrationTest
    def operator_auth_headers
      credentials = ActionController::HttpAuthentication::Basic.encode_credentials(
        ENV.fetch("CALLPROOF_OPERATOR_USER"),
        ENV.fetch("CALLPROOF_OPERATOR_PASSWORD")
      )
      { "HTTP_AUTHORIZATION" => credentials }
    end
  end
end
