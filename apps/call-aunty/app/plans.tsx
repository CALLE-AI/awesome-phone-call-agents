import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { BackLink } from "@/components/call-aunty/back-link";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { DEMO_BILLING_CATALOG, DEMO_ENTITLEMENTS, DEMO_USAGE } from "@/lib/demo-fallback";
import { saveCachedEntitlements } from "@/lib/entitlements-cache";
import { formatTrpcError } from "@/lib/format-trpc-error";
import { trpc } from "@/lib/trpc";
import { cardElevation } from "@/lib/ui-elevation";

export default function PlansScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { translate } = useLanguage();
  const [usingDemoFallback, setUsingDemoFallback] = useState(false);

  const catalogQuery = trpc.billing.catalog.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });
  const entitlementsQuery = trpc.billing.entitlements.useQuery(undefined, {
    staleTime: 30_000,
    retry: 1,
  });
  const usageQuery = trpc.billing.usage.useQuery(undefined, { staleTime: 15_000, retry: 1 });
  const pricingViewed = trpc.billing.pricingViewed.useMutation();
  const startPurchase = trpc.billing.startPurchase.useMutation();
  const verifyPurchase = trpc.billing.verifyPurchase.useMutation();
  const restorePurchases = trpc.billing.restorePurchases.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    pricingViewed.mutate(undefined, { onError: () => undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- analytics once
  }, []);

  useEffect(() => {
    const offline =
      catalogQuery.isError || entitlementsQuery.isError || (!catalogQuery.data && !catalogQuery.isLoading);
    setUsingDemoFallback(Boolean(offline && (catalogQuery.isError || entitlementsQuery.isError)));
  }, [catalogQuery.data, catalogQuery.isError, catalogQuery.isLoading, entitlementsQuery.isError]);

  useEffect(() => {
    if (entitlementsQuery.data) {
      void saveCachedEntitlements(entitlementsQuery.data).catch(() => undefined);
    }
  }, [entitlementsQuery.data]);

  const catalog = catalogQuery.data ?? (usingDemoFallback || catalogQuery.isError ? DEMO_BILLING_CATALOG : undefined);
  const entitlements =
    entitlementsQuery.data ?? (usingDemoFallback || entitlementsQuery.isError ? DEMO_ENTITLEMENTS : undefined);
  const usage = usageQuery.data ?? (usingDemoFallback || usageQuery.isError ? DEMO_USAGE : undefined);

  const plans = catalog?.plans ?? [];
  const indicator = catalog?.flags?.indicator ?? "DEMO";
  const billingDisabled = catalog?.flags?.billingEnabled === false;
  const currentPlanId = entitlements?.planId ?? "community_free";
  const isLoading = catalogQuery.isLoading && !catalog;

  const copy = useMemo(
    () => ({
      title: translate("billing.title"),
      subtitle: translate("billing.subtitle"),
      back: translate("common.back"),
      usage: translate("billing.usage"),
      credits: translate("billing.credits"),
      current: translate("common.current"),
      seats: translate("billing.seats"),
      comingSoon: translate("billing.comingSoon"),
      demoBuy: translate("billing.demoBuy"),
      restore: translate("billing.restore"),
      restoreEmpty: translate("billing.restoreEmpty"),
      successTitle: translate("billing.successTitle"),
      successBody: translate("billing.successBody"),
      errorTitle: translate("billing.errorTitle"),
      loadError: translate("billing.loadError"),
      retry: translate("common.retry"),
      billingOff: translate("billing.billingOff"),
      purchaseError: translate("billing.purchaseError"),
      loading: translate("common.loading"),
      working: translate("billing.working"),
      demoOffline: translate("billing.demoOfflineBanner"),
    }),
    [translate],
  );

  async function handleMockPurchase(planId: string) {
    if (usingDemoFallback || catalogQuery.isError) {
      Alert.alert(copy.successTitle, copy.successBody);
      return;
    }
    try {
      await startPurchase.mutateAsync({ planId });
      await verifyPurchase.mutateAsync({
        planId,
        receiptToken: `mock_receipt_${Date.now()}`,
      });
      await utils.billing.entitlements.invalidate();
      await utils.billing.usage.invalidate();
      Alert.alert(copy.successTitle, copy.successBody);
    } catch (error) {
      Alert.alert(copy.errorTitle, formatTrpcError(error, copy.purchaseError));
    }
  }

  async function handleRestore() {
    if (usingDemoFallback || catalogQuery.isError) {
      Alert.alert(copy.restore, copy.restoreEmpty);
      return;
    }
    try {
      const result = await restorePurchases.mutateAsync();
      const count = "restored" in result && Array.isArray(result.restored) ? result.restored.length : 0;
      Alert.alert(
        copy.restore,
        count > 0 ? translate("billing.restoreCount", { count }) : copy.restoreEmpty,
      );
    } catch (error) {
      Alert.alert(copy.errorTitle, formatTrpcError(error, copy.purchaseError));
    }
  }

  function retryAll() {
    void catalogQuery.refetch();
    void entitlementsQuery.refetch();
    void usageQuery.refetch();
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label={copy.back} onPress={() => router.back()} />

        <ScreenHeader eyebrow={indicator} title={copy.title} subtitle={copy.subtitle} />

        {usingDemoFallback || catalogQuery.isError ? (
          <View style={[styles.banner, { backgroundColor: tints.amberSoft, borderColor: colors.border }]}>
            <Text style={[styles.meta, { color: colors.foreground }]}>{copy.demoOffline}</Text>
            <Pressable onPress={retryAll} style={[styles.retryBtn, { borderColor: colors.coral }]}>
              <Text style={{ color: colors.coral, fontWeight: "800" }}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        {billingDisabled ? (
          <View style={[styles.banner, { backgroundColor: tints.coralSoft, borderColor: colors.border }]}>
            <Text style={[styles.meta, { color: colors.foreground }]}>{copy.billingOff}</Text>
          </View>
        ) : null}

        {isLoading ? <Text style={[styles.meta, { color: colors.muted }]}>{copy.loading}</Text> : null}

        {usage ? (
          <View style={[styles.usageCard, { backgroundColor: tints.coralSoft, borderColor: colors.border }]}>
            <Text style={[styles.usageTitle, { color: colors.foreground }]}>{copy.usage}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {copy.credits}: {usage.callCreditsBalance}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{usage.subscriptionStateLabel}</Text>
          </View>
        ) : null}

        {plans.map((plan) => {
          const planId = "planId" in plan ? String(plan.planId) : "";
          const isCurrent = planId === currentPlanId;
          const billable = "billable" in plan ? Boolean(plan.billable) : false;
          const comingSoon = "comingSoon" in plan ? Boolean(plan.comingSoon) : false;
          const canBuy = billable && !comingSoon && !billingDisabled;
          const credits =
            "callCreditsIncluded" in plan
              ? plan.callCreditsIncluded
              : "callCreditsIncluded" in plan
                ? (plan as { callCreditsIncluded?: number }).callCreditsIncluded
                : 0;
          const seats = "seatsIncluded" in plan ? plan.seatsIncluded : 0;
          const displayName = "displayName" in plan ? String(plan.displayName) : planId;
          const description = "description" in plan ? String(plan.description) : "";
          const displayPrice =
            "displayPrice" in plan
              ? String(plan.displayPrice)
              : "displayPrice" in plan
                ? String((plan as { displayPrice?: string }).displayPrice ?? "")
                : "";

          return (
            <View
              key={planId}
              style={[
                styles.planCard,
                cardElevation,
                {
                  backgroundColor: colors.surface,
                  borderColor: isCurrent ? colors.coral : colors.border,
                  borderWidth: isCurrent ? 2 : 1,
                },
              ]}
            >
              <View style={styles.planHeader}>
                <Text style={[styles.planName, { color: colors.foreground }]}>{displayName}</Text>
                {isCurrent ? (
                  <View style={[styles.badge, { backgroundColor: tints.mintSoft }]}>
                    <Text style={[styles.badgeText, { color: colors.success }]}>{copy.current}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.planPrice, { color: colors.coral }]}>{displayPrice}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{description}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {copy.credits}: {credits} · {copy.seats}: {seats}
              </Text>
              {comingSoon ? (
                <Text style={[styles.comingSoon, { color: colors.warning }]}>{copy.comingSoon}</Text>
              ) : canBuy ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={startPurchase.isPending || verifyPurchase.isPending}
                  onPress={() => void handleMockPurchase(planId)}
                  style={[styles.buyBtn, { backgroundColor: colors.coral }]}
                >
                  <Text style={styles.buyBtnText}>
                    {startPurchase.isPending || verifyPurchase.isPending ? copy.working : copy.demoBuy}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <Pressable
          accessibilityRole="button"
          disabled={restorePurchases.isPending || billingDisabled}
          onPress={() => void handleRestore()}
          style={[styles.restoreBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.restoreText, { color: colors.primary }]}>{copy.restore}</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 36, gap: 14 },
  banner: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  retryBtn: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  usageCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  usageTitle: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 18 },
  planCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 8 },
  planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planName: { fontSize: 17, fontWeight: "800", flex: 1 },
  planPrice: { fontSize: 22, fontWeight: "800" },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  comingSoon: { fontSize: 12, fontWeight: "700" },
  buyBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  buyBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  restoreBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  restoreText: { fontSize: 14, fontWeight: "800" },
});
