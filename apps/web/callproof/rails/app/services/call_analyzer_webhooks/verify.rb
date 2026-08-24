# frozen_string_literal: true

require "openssl"

module CallAnalyzerWebhooks
  class Verify
    MAX_AGE = 5.minutes

    def self.call(body:, timestamp:, signature:, secret:)
      return false if timestamp.blank? || signature.blank? || secret.blank?

      timestamp_value = Integer(timestamp, exception: false)
      return false unless timestamp_value
      return false if (Time.current.to_i - timestamp_value).abs > MAX_AGE

      digest = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{timestamp}.#{body}")
      expected = "v1=#{digest}"
      signature.bytesize == expected.bytesize && ActiveSupport::SecurityUtils.secure_compare(signature, expected)
    end
  end
end
