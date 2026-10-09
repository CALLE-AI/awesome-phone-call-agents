import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireVerifiedPrincipal } from "../db/auth";
import { createSupabaseServerClient } from "../db/server";
import {
  maskedDestination,
  safeDashboardText,
  type FamilyWorkspace,
} from "./workspace";

type Row = Record<string, unknown>;

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error("Family workspace data is unavailable");
  return data as Row[];
}

export async function loadFamilyWorkspace(client: SupabaseClient): Promise<FamilyWorkspace> {
  await requireVerifiedPrincipal(client);
  const memberships = await rows(client.from("senior_memberships")
    .select("senior_id,role,can_view_call_content,can_manage_contacts,can_manage_reminders")
    .is("revoked_at", null));
  const seniorIds = memberships.map((row) => String(row.senior_id));
  if (!seniorIds.length) return {
    actions: [], calls: [], contacts: [], memberships: [], preferences: [], reminders: [], seniors: [], sms: [],
  };

  const [seniors, contacts, calls, actions, reminders, sms, preferences] = await Promise.all([
    rows(client.from("seniors").select("id,display_name,timezone,approximate_location,interests").in("id", seniorIds)),
    rows(client.from("trusted_contacts").select("id,senior_id,display_name,relationship,destination_e164").in("senior_id", seniorIds).is("revoked_at", null)),
    rows(client.from("call_sessions").select("id,senior_id,status,summary,started_at,ended_at").in("senior_id", seniorIds).order("created_at", { ascending: false }).limit(50)),
    rows(client.from("action_authorizations").select("id,senior_id,action,state,destination_e164,purpose").in("senior_id", seniorIds).in("state", ["confirmed", "consumed"]).order("created_at", { ascending: false }).limit(50)),
    rows(client.from("reminders").select("id,senior_id,status,message,scheduled_for,timezone,channel,destination_e164").in("senior_id", seniorIds).order("scheduled_for", { ascending: false }).limit(100)),
    rows(client.from("sms_messages").select("id,senior_id,status,purpose").in("senior_id", seniorIds).order("created_at", { ascending: false }).limit(50)),
    rows(client.from("senior_preferences").select("senior_id,store_transcripts,store_summaries,retention_days").in("senior_id", seniorIds)),
  ]);

  return {
    memberships: memberships.map((row) => ({
      seniorId: String(row.senior_id), role: row.role as "owner" | "family" | "carer",
      canViewCallContent: row.can_view_call_content === true,
      canManageContacts: row.can_manage_contacts === true,
      canManageReminders: row.can_manage_reminders === true,
    })),
    seniors: seniors.map((row) => ({
      id: String(row.id), displayName: safeDashboardText(row.display_name, 100),
      timezone: safeDashboardText(row.timezone, 100),
      approximateLocation: row.approximate_location ? safeDashboardText(row.approximate_location, 160) : undefined,
      interests: Array.isArray(row.interests) ? row.interests.map((item) => safeDashboardText(item, 80)).slice(0, 20) : [],
    })),
    contacts: contacts.map((row) => ({
      id: String(row.id), seniorId: String(row.senior_id),
      displayName: safeDashboardText(row.display_name, 100),
      relationship: row.relationship ? safeDashboardText(row.relationship, 80) : undefined,
      destination: maskedDestination(row.destination_e164),
    })),
    calls: calls.map((row) => ({
      id: String(row.id), seniorId: String(row.senior_id), status: safeDashboardText(row.status, 30),
      summary: row.summary ? safeDashboardText(row.summary, 1_200) : undefined,
      startedAt: row.started_at ? String(row.started_at) : undefined,
      endedAt: row.ended_at ? String(row.ended_at) : undefined,
    })),
    actions: actions.map((row) => ({
      id: String(row.id), seniorId: String(row.senior_id), action: safeDashboardText(row.action, 80),
      state: safeDashboardText(row.state, 30), destination: maskedDestination(row.destination_e164),
      purpose: safeDashboardText(row.purpose, 200),
    })),
    reminders: reminders.map((row) => ({
      id: String(row.id), seniorId: String(row.senior_id), status: safeDashboardText(row.status, 30),
      message: safeDashboardText(row.message, 500), scheduledFor: String(row.scheduled_for),
      timezone: safeDashboardText(row.timezone, 100), channel: safeDashboardText(row.channel, 20),
      destination: maskedDestination(row.destination_e164),
    })),
    sms: sms.map((row) => ({
      id: String(row.id), seniorId: String(row.senior_id), status: safeDashboardText(row.status, 30),
      purpose: safeDashboardText(row.purpose, 200),
    })),
    preferences: preferences.map((row) => ({
      seniorId: String(row.senior_id), storeTranscripts: row.store_transcripts === true,
      storeSummaries: row.store_summaries === true, retentionDays: Number(row.retention_days),
    })),
  };
}

export async function loadCurrentFamilyWorkspace(): Promise<FamilyWorkspace> {
  return loadFamilyWorkspace(await createSupabaseServerClient());
}
