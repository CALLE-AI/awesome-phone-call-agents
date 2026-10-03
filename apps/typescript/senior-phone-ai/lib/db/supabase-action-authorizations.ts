import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ActionAuthorizationStore,
  type ActionRequest,
  type AuthorizationDecision,
  type PendingAction,
  validateActionRequest,
} from "../safety/authorization";
import { maskPhoneNumber, redactPhoneNumbers } from "../safety/phone";

interface AuthorizationRow {
  readonly action: ActionRequest["action"];
  readonly destination_e164: string;
  readonly details: Readonly<Record<string, string>>;
  readonly expires_at: string;
  readonly id: string;
  readonly principal_user_id: string;
  readonly purpose: string;
  readonly senior_id: string;
  readonly state: "pending" | "confirmed" | "denied" | "consumed" | "expired";
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000;

function sameDetails(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const normalize = (value: Readonly<Record<string, string>>) =>
    JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return normalize(left) === normalize(right);
}

function sameRequest(row: AuthorizationRow, request: ActionRequest): boolean {
  return row.principal_user_id === request.principalId
    && row.senior_id === request.seniorId
    && row.action === request.action
    && row.destination_e164 === request.destinationE164
    && row.purpose === request.purpose
    && sameDetails(row.details, request.details ?? {});
}

export class SupabaseActionAuthorizationStore implements ActionAuthorizationStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error("authorization TTL must be a positive integer");
    }
  }

  async propose(request: ActionRequest): Promise<PendingAction> {
    const validated = validateActionRequest(request);
    const { data: membership, error: membershipError } = await this.client
      .from("senior_memberships")
      .select("senior_id")
      .eq("senior_id", validated.seniorId)
      .eq("user_id", validated.principalId)
      .is("revoked_at", null)
      .maybeSingle();
    if (membershipError || !membership) {
      throw new Error("principal is not authorized for this senior");
    }
    const expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    const { data, error } = await this.client
      .from("action_authorizations")
      .insert({
        action: validated.action,
        destination_e164: validated.destinationE164,
        details: validated.details ?? {},
        expires_at: expiresAt,
        principal_user_id: validated.principalId,
        purpose: validated.purpose,
        senior_id: validated.seniorId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error("could not create action authorization");
    return {
      authorizationId: data.id as string,
      action: validated.action,
      destinationSummary: maskPhoneNumber(validated.destinationE164),
      expiresAt,
      purposeSummary: redactPhoneNumbers(validated.purpose),
    };
  }

  async confirm(
    authorizationId: string,
    principalId: string,
    confirmed: boolean,
  ): Promise<AuthorizationDecision> {
    const { data: row, error } = await this.client
      .from("action_authorizations")
      .select("expires_at")
      .eq("id", authorizationId)
      .eq("principal_user_id", principalId)
      .eq("state", "pending")
      .maybeSingle();
    if (error || !row) return { allowed: false, reason: "denied" };
    const expired = this.now() >= Date.parse(row.expires_at as string);
    const state = expired ? "expired" : confirmed ? "confirmed" : "denied";
    const { data: changed, error: updateError } = await this.client
      .from("action_authorizations")
      .update({
        confirmed_at: state === "confirmed" ? new Date(this.now()).toISOString() : null,
        state,
      })
      .eq("id", authorizationId)
      .eq("principal_user_id", principalId)
      .eq("state", "pending")
      .select("id")
      .maybeSingle();
    if (updateError || !changed) return { allowed: false, reason: "denied" };
    if (expired) return { allowed: false, reason: "expired" };
    return confirmed ? { allowed: true } : { allowed: false, reason: "denied" };
  }

  async consume(
    authorizationId: string,
    request: ActionRequest,
  ): Promise<AuthorizationDecision> {
    try {
      validateActionRequest(request);
    } catch {
      return { allowed: false, reason: "mismatched" };
    }
    const { data, error } = await this.client
      .from("action_authorizations")
      .select("id, senior_id, principal_user_id, action, destination_e164, purpose, details, state, expires_at")
      .eq("id", authorizationId)
      .maybeSingle();
    if (error || !data) return { allowed: false, reason: "denied" };
    const row = data as AuthorizationRow;
    if (row.state === "consumed") return { allowed: false, reason: "already-used" };
    if (row.state !== "confirmed") return { allowed: false, reason: "denied" };
    if (this.now() >= Date.parse(row.expires_at)) {
      await this.client.from("action_authorizations").update({ state: "expired" }).eq("id", authorizationId).eq("state", "confirmed");
      return { allowed: false, reason: "expired" };
    }
    if (!sameRequest(row, request)) return { allowed: false, reason: "mismatched" };
    const { data: changed, error: updateError } = await this.client
      .from("action_authorizations")
      .update({ consumed_at: new Date(this.now()).toISOString(), state: "consumed" })
      .eq("id", authorizationId)
      .eq("state", "confirmed")
      .select("id")
      .maybeSingle();
    if (updateError || !changed) return { allowed: false, reason: "already-used" };
    return { allowed: true };
  }
}
