# frozen_string_literal: true

# Gates privileged workflows (live-call preview/confirm and the call detail view)
# behind HTTP Basic operator credentials. Fails closed: if no operator password is
# configured, the workflow is unavailable to everyone rather than open to any
# anonymous visitor who could otherwise spend the server CALL-E account.
module OperatorAuthenticated
  extend ActiveSupport::Concern

  private

  def authenticate_operator!
    configured_password = ENV["CALLPROOF_OPERATOR_PASSWORD"].to_s
    if configured_password.empty?
      return request_operator_credentials("Operator authentication is not configured.")
    end

    expected_user = ENV["CALLPROOF_OPERATOR_USER"].presence || "operator"
    authenticated = authenticate_with_http_basic do |user, password|
      user_ok = ActiveSupport::SecurityUtils.secure_compare(user.to_s, expected_user)
      password_ok = ActiveSupport::SecurityUtils.secure_compare(password.to_s, configured_password)
      user_ok && password_ok
    end

    request_operator_credentials unless authenticated
  end

  def request_operator_credentials(message = "Operator credentials required.")
    request_http_basic_authentication("CallProof operator")
    message
  end
end
