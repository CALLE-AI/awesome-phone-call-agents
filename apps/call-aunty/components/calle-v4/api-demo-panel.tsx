import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { CallTimeline } from "@/components/calle-v4/call-timeline";
import { ResultCard } from "@/components/calle-v4/result-card";
import { useColors } from "@/hooks/use-colors";
import { useCalleCall } from "@/hooks/use-calle-call";
import { useUiTints } from "@/hooks/use-ui-tints";
import { MobileCalleApi } from "@/lib/calle-v4/api";
import { CallQueue } from "@/lib/calle-v4/queue";
import { label } from "@/lib/calle-v4/status";

const DEMO_TASK =
  "Call an authorized test recipient and confirm availability for a community health follow-up. Do not collect passwords, one-time codes, or payment details.";
const DEMO_PHONE = "+15555550123";

export function CalleApiDemoPanel() {
  const colors = useColors();
  const tints = useUiTints();
  const api = useMemo(() => new MobileCalleApi(), []);
  const queue = useMemo(() => new CallQueue(), []);
  const [callId, setCallId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { call, error, refresh } = useCalleCall(api, callId);

  async function createAuthorizedDemo() {
    setBusy(true);
    setMessage(null);
    const clientRequestId = `demo-${Date.now()}`;
    try {
      const created = await api.create({
        task: DEMO_TASK,
        phones: [DEMO_PHONE],
        clientRequestId,
        consent: true,
        region: "US",
      });
      setCallId(created.id);
      setMessage(`Created ${created.id} · ${label(created.status)}`);
    } catch (caught) {
      queue.enqueue({
        localId: clientRequestId,
        task: DEMO_TASK,
        phones: [DEMO_PHONE],
        clientRequestId,
        createdAt: Date.now(),
      });
      setMessage(
        `Queued offline (${queue.size()}). ${caught instanceof Error ? caught.message : "Create failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!callId) return;
    setBusy(true);
    try {
      const result = await api.reconcile(callId);
      setMessage(result.changed ? "Provider state changed — refreshed." : "Already in sync with CALL-E.");
      await refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.coral, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 }}>
        CALL-E API · RUNTIME
      </Text>
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>
        Authorized test call
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
        Server validates E.164, consent, and result schema, then calls CALL-E `/v1/calls` (demo
        provider unless live mode is enabled). Uses the fixture number {DEMO_PHONE}, never a
        production recipient.
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void createAuthorizedDemo()}
        style={{
          backgroundColor: colors.coral,
          borderRadius: 12,
          paddingVertical: 12,
          alignItems: "center",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "700" }}>Create CALL-E request</Text>
        )}
      </Pressable>

      {callId ? (
        <Pressable onPress={() => void reconcile()}>
          <Text style={{ color: colors.coral, fontWeight: "800" }}>Reconcile with provider</Text>
        </Pressable>
      ) : null}

      {message ? <Text style={{ color: colors.foreground, fontSize: 13 }}>{message}</Text> : null}
      {error ? <Text style={{ color: colors.coral, fontSize: 13 }}>{error}</Text> : null}

      {call ? (
        <View style={{ backgroundColor: tints.coralSoft, borderRadius: 12, padding: 12, gap: 10 }}>
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>
            {label(call.status)} · {call.id}
          </Text>
          <CallTimeline status={call.status} />
          <ResultCard result={call.structured_result} />
        </View>
      ) : null}
    </View>
  );
}
