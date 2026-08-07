# frozen_string_literal: true

class LiveCallsController < ApplicationController
  include OperatorAuthenticated

  before_action :authenticate_operator!
  before_action :load_call_request, only: %i[show confirm cancel reconcile]

  def new
    @call_request = CallRequest.new
  end

  def create
    provider, policy = LiveCalls::Setup.call(
      region: live_call_params.fetch(:region),
      maximum_surcharge_cents: surcharge_cents
    )
    @call_request = CallRequest.create!(
      provider_profile: provider,
      call_policy: policy,
      recipient_phone_e164: live_call_params.fetch(:recipient_phone_e164),
      objective: live_call_params.fetch(:objective),
      status: "awaiting_confirmation",
      simulation_scenario: "compliant",
      live_mode: false,
      operator_initiated: true
    )
    CallContracts::Build.call(@call_request)
    redirect_to live_call_path(@call_request), notice: "Preview created. No call has been placed."
  rescue ActiveRecord::RecordInvalid, KeyError, ArgumentError => error
    @call_request ||= CallRequest.new
    flash.now[:alert] = error.message
    render :new, status: :unprocessable_content
  end

  def show
    @contract = @call_request.call_contract
    @confirmation_phrase = confirmation_phrase
    @readiness = {
      provider: ENV["CALLPROOF_CALL_PROVIDER"] == "calle",
      live_switch: ENV["CALLPROOF_LIVE_CALLS"] == "true",
      api_key: ENV["CALLE_API_KEY"].present?
    }
  end

  def confirm
    raise CallProviders::Calle::SafetyError, "confirmation phrase does not match" unless
      ActiveSupport::SecurityUtils.secure_compare(params[:confirmation_phrase].to_s, confirmation_phrase)
    ensure_live_environment!

    @call_request.with_lock do
      raise CallProviders::Calle::SafetyError, "call is no longer awaiting confirmation" unless
        @call_request.status == "awaiting_confirmation"
      @call_request.update!(live_mode: true, confirmed_at: Time.current)
    end

    result = ExecutePhoneCallFlow.call(call_request: @call_request)
    @call_request.update!(agentkit_run_id: result.run.run_id)
    @call_request.reload

    if @call_request.status == "unresolved"
      # Ambiguous create (timeout/5xx): the call may have been placed. Never claim it
      # "failed safely" — send the operator to reconcile.
      return redirect_to call_request_path(@call_request),
                         alert: "CALL-E outcome is unknown — the call may have been placed. Reconcile before retrying."
    end

    @call_request.update!(status: "failed") if result.err? && @call_request.phone_call.nil?
    redirect_to call_request_path(@call_request),
                notice: result.ok? ? "CALL-E accepted the request." : "CALL-E execution failed safely."
  rescue CallProviders::Calle::Error, ActiveRecord::RecordInvalid => error
    redirect_to live_call_path(@call_request), alert: error.message
  end

  # Reconcile an unresolved live request. Re-attempts the create with the SAME stable
  # Idempotency-Key, so CALL-E deduplicates — this cannot place a second call.
  #
  # An unresolved request is resolved only by an answer that identifies it by that key:
  # either the provider hands back the call (it exists → running), or it rejects the
  # payload itself, which an accepted original would have deduplicated past (→ failed).
  #
  # Every other failure leaves it unresolved, including ones that look conclusive. A 401
  # means our credential is bad now and says nothing about whether the original request
  # was accepted; resolving it to "failed" would tell the operator no call was placed
  # while a call may be ringing. Staying unresolved is the only honest answer.
  def reconcile
    ensure_live_environment!
    raise CallProviders::Calle::SafetyError, "call is not awaiting reconciliation" unless
      @call_request.status == "unresolved"

    contract = @call_request.call_contract || CallContracts::Build.call(@call_request)
    phone_call = CallProviders.current.call(call_request: @call_request, contract: contract)
    redirect_to call_request_path(@call_request),
                notice: "Reconciled — CALL-E has the call (#{phone_call.status})."
  rescue CallProviders::Calle::DefinitiveRejectionError => error
    @call_request.update!(status: "failed")
    redirect_to call_request_path(@call_request),
                alert: "Reconciliation resolved to failed (CALL-E rejected the request " \
                       "itself under the same idempotency key, so no call was placed): #{error.message}"
  rescue CallProviders::Calle::Error, ActiveRecord::RecordInvalid => error
    @call_request.update!(status: "unresolved")
    redirect_to call_request_path(@call_request),
                alert: "Still unresolved — this attempt says nothing about the original " \
                       "request, so the outcome remains unknown: #{error.message}"
  end

  def cancel
    @call_request.with_lock do
      if @call_request.status == "awaiting_confirmation"
        @call_request.update!(status: "canceled")
      end
    end
    redirect_to live_call_path(@call_request), notice: "Draft canceled. No call was placed."
  end

  private

  def load_call_request
    @call_request = CallRequest.find(params[:id])
  end

  def live_call_params
    params.expect(call_request: %i[objective recipient_phone_e164 region maximum_surcharge_dollars])
  end

  def surcharge_cents
    dollars = BigDecimal(live_call_params.fetch(:maximum_surcharge_dollars))
    raise ArgumentError, "maximum surcharge must be between $0 and $1,000" unless dollars.between?(0, 1_000)

    (dollars * 100).round.to_i
  end

  def confirmation_phrase
    @call_request.confirmation_phrase
  end

  def ensure_live_environment!
    raise CallProviders::Calle::SafetyError, "CALLPROOF_CALL_PROVIDER must be calle" unless
      ENV["CALLPROOF_CALL_PROVIDER"] == "calle"
    raise CallProviders::Calle::SafetyError, "CALLPROOF_LIVE_CALLS must be exactly true" unless
      ENV["CALLPROOF_LIVE_CALLS"] == "true"
    raise CallProviders::Calle::SafetyError, "CALLE_API_KEY is missing" if ENV["CALLE_API_KEY"].blank?
  end
end
