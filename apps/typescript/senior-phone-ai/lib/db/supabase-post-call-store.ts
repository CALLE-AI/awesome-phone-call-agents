import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostCallRecord, PostCallSmsStatus, PostCallStore } from "../post-call/finalizer";

function parseRecord(value: unknown): PostCallRecord {
  if (!value || typeof value !== "object") throw new Error("invalid post-call record");
  return value as PostCallRecord;
}

export class SupabasePostCallStore implements PostCallStore {
  constructor(private readonly client: SupabaseClient) {}

  async claimSms(id: string) {
    const { data, error } = await this.client.rpc("claim_post_call_sms", { p_id: id });
    if (error) throw new Error("could not claim post-call SMS delivery");
    if (!data || typeof data !== "object" || !("record" in data)) throw new Error("invalid post-call SMS claim");
    return {
      claimed: data.claimed === true,
      record: parseRecord(data.record),
    };
  }

  async reserve(record: PostCallRecord) {
    const { data, error } = await this.client.rpc("reserve_post_call_finalization", {
      p_id: record.id,
      p_senior_id: record.seniorId,
      p_call_id: record.callSessionId,
      p_provider_call_id: record.callId,
      p_fingerprint: record.fingerprint,
      p_summary: record.summary,
      p_sms_message: record.smsMessage,
      p_created_at: record.createdAt,
    });
    if (error) throw new Error("could not reserve post-call finalization");
    const stored = parseRecord(data);
    return { created: stored.id === record.id, record: stored };
  }

  async updateSms(id: string, status: Exclude<PostCallSmsStatus, "not_requested">): Promise<PostCallRecord> {
    const { data, error } = await this.client.rpc("update_post_call_sms_status", {
      p_id: id,
      p_status: status,
    });
    if (error) throw new Error("could not update post-call SMS status");
    return parseRecord(data);
  }
}
