import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { AppearanceToggle } from "@/components/call-aunty/appearance-toggle";
import { PasscodeModal } from "@/components/call-aunty/passcode-modal";
import { RoleToggle } from "@/components/call-aunty/role-toggle";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAppRole } from "@/contexts/app-role";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { APP_LOCK_TIMEOUT_OPTIONS, formatAppLockTimeout, loadAppLockTimeout, saveAppLockTimeout, type AppLockTimeoutMs } from "@/lib/app-lock-preferences";
import { clearPasscode, hasPasscode, savePasscode, verifyPasscode } from "@/lib/passcode";
import { getBiometricAvailability, loadPrivacyLock } from "@/lib/privacy-lock";
import { getSecurityStatusSummary, getSecurityCopy } from "@/lib/security-copy";
import { getLanguageOption, type AppLanguage } from "@/lib/language";
import { getSettingsCopy, getAppCopy } from "@/lib/app-copy";
import { cardElevation, TAB_SCROLL_BOTTOM } from "@/lib/ui-elevation";
import { getPasscodeStrength } from "@/lib/passcode-utils";
import { getCapabilitySummary, loadNativeCapabilityState, type NativeCapabilityState } from "@/lib/native-capabilities";
import { getLowDataCopy } from "@/lib/low-data-copy";
import { DEFAULT_LOW_DATA_MODE, loadLowDataMode, saveLowDataMode, type LowDataMode } from "@/lib/low-data-preferences";
import { getOfflineContentPack, getOfflineContentTopicCount } from "@/lib/offline-content";
import { getOfflineContentCopy } from "@/lib/offline-content-copy";
import { clearOfflineData } from "@/lib/offline-data";
import { getOfflineDataCopy } from "@/lib/offline-data-copy";
import { DEFAULT_CARE_PREFERENCES, loadCarePreferences, saveCarePreferences, type CarePreferences } from "@/lib/care-preferences";

export default function SettingsScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const [lockTimeout, setLockTimeout] = useState<AppLockTimeoutMs>(60_000);
  const [passcodeConfigured, setPasscodeConfigured] = useState(false);
  const [passcodeModalOpen, setPasscodeModalOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | undefined>();
  const [passcodeMode, setPasscodeMode] = useState<"new" | "current" | "confirm" | "reset" | null>(null);
  const [passcodeDraft, setPasscodeDraft] = useState("");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const { language, direction, translate } = useLanguage();
  const { role } = useAppRole();
  const copy = getSettingsCopy(language);
  const appCopy = getAppCopy(language);
  const [timeoutPickerOpen, setTimeoutPickerOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<NativeCapabilityState>({ biometricAvailable: false, secureStorageAvailable: false, backgroundTaskAvailable: false, backgroundTaskRegistered: false });
  const [lowDataMode, setLowDataMode] = useState<LowDataMode>(DEFAULT_LOW_DATA_MODE);
  const [privacyLockEnabled, setPrivacyLockEnabled] = useState(false);
  const [carePreferences, setCarePreferences] = useState<CarePreferences>(DEFAULT_CARE_PREFERENCES);
  useEffect(() => {
    void loadAppLockTimeout().then(setLockTimeout).catch(() => setLockTimeout(60_000));
    void hasPasscode().then(setPasscodeConfigured).catch(() => setPasscodeConfigured(false));
    void getBiometricAvailability().then(setBiometricAvailable).catch(() => setBiometricAvailable(false));
    void loadNativeCapabilityState().then(setCapabilities).catch(() => setCapabilities({ biometricAvailable: false, secureStorageAvailable: false, backgroundTaskAvailable: false, backgroundTaskRegistered: false }));
    void loadLowDataMode().then(setLowDataMode).catch(() => setLowDataMode(DEFAULT_LOW_DATA_MODE));
    void loadPrivacyLock().then(setPrivacyLockEnabled).catch(() => setPrivacyLockEnabled(false));
    void loadCarePreferences().then(setCarePreferences).catch(() => setCarePreferences(DEFAULT_CARE_PREFERENCES));
  }, []);

  async function toggleCarePreference(key: keyof CarePreferences) {
    const next = { ...carePreferences, [key]: !carePreferences[key] };
    try {
      const saved = await saveCarePreferences(next);
      if (!saved) {
        Alert.alert(copy.remindersAlertTitle, copy.languageSaveErrorBody);
        return;
      }
      setCarePreferences(next);
    } catch {
      Alert.alert(copy.remindersAlertTitle, copy.languageSaveErrorBody);
    }
  }
  async function toggleLowDataMode() {
    const lowDataCopy = getLowDataCopy(language);
    const next = { ...lowDataMode, enabled: !lowDataMode.enabled };
    try {
      const saved = await saveLowDataMode(next);
      if (!saved) {
        Alert.alert(lowDataCopy.alertTitle, lowDataCopy.saveError);
        return;
      }
      setLowDataMode(next);
      Alert.alert(lowDataCopy.alertTitle, lowDataCopy.detail);
    } catch {
      Alert.alert(lowDataCopy.alertTitle, lowDataCopy.saveError);
    }
  }

  async function clearOfflineDataWithConfirmation() {
    const offlineCopy = getOfflineDataCopy(language);
    if (privacyLockEnabled) {
      Alert.alert(offlineCopy.title, offlineCopy.locked);
      return;
    }
    Alert.alert(offlineCopy.title, offlineCopy.body, [{ text: offlineCopy.cancel, style: "cancel" }, { text: offlineCopy.clear, style: "destructive", onPress: () => { void clearOfflineData().then((cleared) => Alert.alert(offlineCopy.title, cleared ? offlineCopy.success : offlineCopy.error)).catch(() => Alert.alert(offlineCopy.title, offlineCopy.error)); } }]);
  }

  async function submitPasscodeStep() {
    if (passcodeMode === "current" || passcodeMode === "reset") {
      let valid = false;
      try {
        valid = await verifyPasscode(passcodeInput);
      } catch {
        setPasscodeError(copy.passcodeSaveError);
        return;
      }
      if (!valid) {
        setPasscodeError(copy.passcodeMismatch);
        return;
      }
      if (passcodeMode === "reset") {
        try {
          await clearPasscode();
          setPasscodeConfigured(false);
          closePasscodeModal();
        } catch {
          setPasscodeError(copy.passcodeSaveError);
        }
        return;
      }
      setPasscodeMode("new");
      setPasscodeInput("");
      setPasscodeError(undefined);
      return;
    }
    if (passcodeMode === "new") {
      if (passcodeInput.length < 4 || passcodeInput.length > 6) {
        setPasscodeError(copy.passcodeLength);
        return;
      }
      setPasscodeDraft(passcodeInput);
      setPasscodeInput("");
      setPasscodeMode("confirm");
      setPasscodeError(undefined);
      return;
    }
    if (passcodeMode === "confirm") {
      if (passcodeInput !== passcodeDraft) {
        setPasscodeError(copy.passcodeConfirmMismatch);
        setPasscodeInput("");
        return;
      }
      try {
        await savePasscode(passcodeDraft);
        setPasscodeConfigured(true);
      } catch {
        setPasscodeError(copy.passcodeSaveError);
        return;
      }
      closePasscodeModal();
    }
  }

  function closePasscodeModal() {
    setPasscodeModalOpen(false);
    setPasscodeMode(null);
    setPasscodeInput("");
    setPasscodeDraft("");
    setPasscodeError(undefined);
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={[styles.content, { direction }]} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow={copy.eyebrow} title={getSecurityCopy(language).settingsTitle} subtitle={copy.subtitle} />
        <View style={[styles.profileCard, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.avatar, { backgroundColor: colors.primary }]}><Text style={styles.avatarText}>{role === "chw" ? "S" : "A"}</Text></View><View style={{ flex: 1 }}><Text style={[styles.profileName, { color: colors.foreground }]}>{role === "chw" ? copy.profileNameChw : copy.profileNameWoman}</Text><Text style={[styles.profileMeta, { color: colors.muted }]}>{role === "chw" ? copy.profileMetaChw : copy.profileMeta}</Text></View></View>
        <Text style={[styles.section, { color: colors.foreground }]}>{translate("settings.appearance")}</Text>
        <Text style={[styles.sectionHint, { color: colors.muted }]}>{translate("settings.appearanceDetail")}</Text>
        <AppearanceToggle lightLabel={translate("settings.light")} darkLabel={translate("settings.dark")} />
        <Text style={[styles.section, { color: colors.foreground }]}>{translate("settings.role")}</Text>
        <Text style={[styles.sectionHint, { color: colors.muted }]}>{translate("settings.roleDetail")}</Text>
        <RoleToggle womanLabel={appCopy.womanView} chwLabel={appCopy.chwView} />
        <Text style={[styles.section, { color: colors.foreground }]}>{copy.reachSection}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/plans")}
          style={({ pressed }) => [styles.planLink, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed]}
        >
          <View style={[styles.rowIcon, { backgroundColor: tints.lavenderSoft }]}>
            <IconSymbol name="creditcard.fill" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              {translate("settings.plansPricing")}
            </Text>
            <Text style={[styles.rowDetail, { color: colors.muted }]}>
              {translate("settings.plansDetail")}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("settings.phoneAgent")}
          onPress={() => router.push("/calle-agent" as Href)}
          style={({ pressed }) => [styles.planLink, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed]}
        >
          <View style={[styles.rowIcon, { backgroundColor: tints.coralSoft }]}>
            <IconSymbol name="phone.fill" size={19} color={colors.coral} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{translate("settings.phoneAgent")}</Text>
            <Text style={[styles.rowDetail, { color: colors.muted }]}>
              {translate("settings.phoneAgentDetail")}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={getOfflineDataCopy(language).label} onPress={() => void clearOfflineDataWithConfirmation()} style={({ pressed }) => [styles.dangerRow, { backgroundColor: tints.coralSoft }, pressed && styles.pressed]}><View style={[styles.rowIcon, { backgroundColor: colors.surface }]}><IconSymbol name="trash.fill" size={19} color={colors.coral} /></View><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{getOfflineDataCopy(language).label}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{getOfflineDataCopy(language).detail}</Text></View><IconSymbol name="chevron.right" size={18} color={colors.muted} /></Pressable>
        <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingRow icon="globe" title={getSecurityCopy(language).languageLabel} detail={getLanguageOption(language).nativeName} colors={colors} tints={tints} onPress={() => router.push("/language")} />
          <SettingRow icon="phone.fill" title={getSecurityCopy(language).safeContactLabel} detail={copy.safeWindow} colors={colors} tints={tints} onPress={() => Alert.alert(copy.safeWindowAlertTitle, copy.safeWindowAlertBody)} />
          <SettingRow icon="lock.fill" title={getSecurityCopy(language).sharedPhoneLabel} detail={copy.sharedPhoneDetail} colors={colors} tints={tints} toggle toggleValue={carePreferences.sharedPhonePrivacy} onPress={() => void toggleCarePreference("sharedPhonePrivacy")} />
          <SettingRow icon="lock.fill" title={getSecurityCopy(language).autoLockLabel} detail={`${formatAppLockTimeout(lockTimeout)} ${copy.autoLockAfter}`} colors={colors} tints={tints} onPress={() => setTimeoutPickerOpen(true)} />
          <SettingRow icon="lock.fill" title={getSecurityCopy(language).passcodeFallbackLabel} detail={passcodeConfigured ? copy.passcodeConfigured : copy.passcodeMissing} colors={colors} tints={tints} onPress={() => { setPasscodeInput(""); setPasscodeError(undefined); setPasscodeMode(passcodeConfigured ? "current" : "new"); setPasscodeModalOpen(true); }} />
          <SettingRow icon="globe" title={getLowDataCopy(language).label} detail={lowDataMode.enabled ? getLowDataCopy(language).enabled : getLowDataCopy(language).disabled} colors={colors} tints={tints} toggle toggleValue={lowDataMode.enabled} onPress={() => void toggleLowDataMode()} />
          <SettingRow icon="globe" title={getOfflineContentCopy(language).label} detail={getOfflineContentCopy(language).detail(getOfflineContentTopicCount(language))} colors={colors} tints={tints} onPress={() => { const pack = getOfflineContentPack(language); Alert.alert(getOfflineContentCopy(language).title, `${getOfflineContentCopy(language).body}\n\n${pack.version}`); }} last />
        </View>
        <Text style={[styles.section, { color: colors.foreground }]}>{getSecurityCopy(language).securitySection}</Text>
        <View accessibilityRole="summary" style={[styles.securityCard, { backgroundColor: tints.securitySoft, borderColor: tints.securityBorder }]}><View style={styles.securityHeader}><View style={[styles.rowIcon, { backgroundColor: colors.surface }]}><IconSymbol name="lock.fill" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{getSecurityCopy(language).securityTitle}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{getSecurityStatusSummary({ passcodeConfigured, biometricAvailable, locked: false, language })}</Text></View></View><Text style={[styles.securityDetail, { color: colors.muted }]}>{getSecurityCopy(language).protectedStorage} · {formatAppLockTimeout(lockTimeout)} {copy.securityAutoLock}</Text><View style={styles.securityPills}><View style={[styles.securityPillWrap, { backgroundColor: colors.surface }]}><Text style={[styles.securityPill, { color: biometricAvailable ? colors.success : colors.muted }]}>{biometricAvailable ? getSecurityCopy(language).biometricReady : getSecurityCopy(language).biometricUnavailable}</Text></View><View style={[styles.securityPillWrap, { backgroundColor: colors.surface }]}><Text style={[styles.securityPill, { color: passcodeConfigured ? colors.success : colors.warning }]}>{passcodeConfigured ? getSecurityCopy(language).passcodeReady : getSecurityCopy(language).passcodeMissing}</Text></View></View></View>
        <View accessibilityRole="summary" style={[styles.capabilityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.securityHeader}><View style={[styles.rowIcon, { backgroundColor: tints.lavenderSoft }]}><IconSymbol name="arrow.clockwise" size={19} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{getCapabilitySummary(capabilities, language).backgroundLabel}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{getCapabilitySummary(capabilities, language).background}</Text></View></View><Text style={[styles.rowDetail, { color: colors.muted }]}>{getCapabilitySummary(capabilities, language).storage} · {getCapabilitySummary(capabilities, language).biometric}</Text></View>
        <Text style={[styles.section, { color: colors.foreground }]}>{getSecurityCopy(language).remindersSection}</Text>
        <View style={[styles.reminderCard, { backgroundColor: tints.mintSoft }]}><IconSymbol name="calendar" size={21} color={colors.success} /><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{getSecurityCopy(language).remindersTitle}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{getSecurityCopy(language).remindersDetail}</Text></View><Switch accessibilityRole="switch" accessibilityLabel={getSecurityCopy(language).remindersTitle} value={carePreferences.remindersEnabled} onValueChange={() => void toggleCarePreference("remindersEnabled")} trackColor={{ false: colors.border, true: colors.success }} thumbColor="#FFFFFF" /></View>
        {passcodeConfigured && <Pressable accessibilityRole="button" accessibilityLabel={getSecurityCopy(language).resetPasscode} onPress={() => { setPasscodeInput(""); setPasscodeError(undefined); setPasscodeMode("reset"); setPasscodeModalOpen(true); }} style={({ pressed }) => [styles.privacyLink, pressed && styles.pressed]}><IconSymbol name="lock.fill" size={18} color={colors.error} /><Text style={[styles.privacyText, { color: colors.error }]}>{getSecurityCopy(language).resetPasscode}</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={getSecurityCopy(language).privacyPromise} onPress={() => Alert.alert(copy.privacyAlertTitle, copy.privacyAlertBody)} style={({ pressed }) => [styles.privacyLink, pressed && styles.pressed]}><IconSymbol name="lock.fill" size={18} color={colors.primary} /><Text style={[styles.privacyText, { color: colors.primary }]}>{getSecurityCopy(language).privacyPromise}</Text></Pressable>
      </ScrollView>
      <TimeoutPickerModal visible={timeoutPickerOpen} selected={lockTimeout} language={language} colors={colors} tints={tints} onSelect={async (next) => { try { const saved = await saveAppLockTimeout(next); if (!saved) { Alert.alert(copy.timeoutSaveErrorTitle, copy.timeoutSaveErrorBody); return; } setLockTimeout(next); setTimeoutPickerOpen(false); } catch { Alert.alert(copy.timeoutSaveErrorTitle, copy.timeoutSaveErrorBody); } }} onCancel={() => setTimeoutPickerOpen(false)} />
      <PasscodeModal visible={passcodeModalOpen} title={passcodeMode === "current" ? copy.verifyCurrent : passcodeMode === "confirm" ? copy.confirmNew : passcodeMode === "reset" ? copy.resetFallback : copy.setFallback} subtitle={passcodeMode === "current" ? copy.verifyBeforeChange : passcodeMode === "confirm" ? copy.enterAgain : passcodeMode === "reset" ? copy.verifyBeforeClear : getSecurityCopy(language).lockSubtitle} value={passcodeInput} error={passcodeError} strengthLabel={(passcodeMode === "new" || passcodeMode === "confirm") ? getPasscodeStrength(passcodeInput) : undefined} submitLabel={passcodeMode === "reset" ? copy.reset : passcodeMode === "current" ? copy.continue : passcodeMode === "confirm" ? copy.savePasscode : copy.continue} cancelLabel={getSecurityCopy(language).cancel} waitLabel={getSecurityCopy(language).wait} onChange={(value) => { setPasscodeInput(value); setPasscodeError(undefined); }} onCancel={closePasscodeModal} onSubmit={() => void submitPasscodeStep()} />
    </ScreenContainer>
  );
}

function SettingRow({ icon, title, detail, colors, tints, onPress, toggle, toggleValue = true, last }: { icon: "globe" | "phone.fill" | "lock.fill"; title: string; detail: string; colors: ReturnType<typeof useColors>; tints: ReturnType<typeof useUiTints>; onPress?: () => void; toggle?: boolean; toggleValue?: boolean; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, last && styles.rowLast, { borderBottomColor: colors.border }, pressed && styles.pressed]}><View style={[styles.rowIcon, { backgroundColor: tints.coralSoft }]}><IconSymbol name={icon} size={19} color={colors.coral} /></View><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{detail}</Text></View>{toggle ? <Switch accessibilityRole="switch" accessibilityLabel={title} value={toggleValue} onValueChange={onPress} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" /> : <IconSymbol name="chevron.right" size={18} color={colors.muted} />}</Pressable>;
}

function TimeoutPickerModal({ visible, selected, language, colors, tints, onSelect, onCancel }: { visible: boolean; selected: AppLockTimeoutMs; language: AppLanguage; colors: ReturnType<typeof useColors>; tints: ReturnType<typeof useUiTints>; onSelect: (value: AppLockTimeoutMs) => void; onCancel: () => void }) {
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onCancel}><View style={[styles.sheetScrim, { backgroundColor: tints.scrim }]}><View style={[styles.sheet, { backgroundColor: colors.surface }]}><View style={[styles.sheetHandle, { backgroundColor: colors.border }]} /><Text style={[styles.sheetTitle, { color: colors.foreground }]}>{getSecurityCopy(language).timeoutTitle}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{getSecurityCopy(language).timeoutSubtitle}</Text>{APP_LOCK_TIMEOUT_OPTIONS.map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={formatAppLockTimeout(option)} accessibilityState={{ selected: selected === option }} onPress={() => onSelect(option)} style={[styles.timeoutOption, { borderColor: selected === option ? colors.primary : colors.border, backgroundColor: selected === option ? tints.lavenderSoft : colors.background }]}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{formatAppLockTimeout(option)}</Text><Text style={[styles.rowDetail, { color: colors.muted }]}>{selected === option ? getSecurityCopy(language).selected : getSecurityCopy(language).tapToChoose}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel={getSecurityCopy(language).cancel} onPress={onCancel} style={styles.sheetCancel}><Text style={[styles.privacyText, { color: colors.primary }]}>{getSecurityCopy(language).cancel}</Text></Pressable></View></View></Modal>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: TAB_SCROLL_BOTTOM, gap: 15 },
  profileCard: { borderRadius: 22, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  profileName: { fontSize: 16, fontWeight: "800" },
  profileMeta: { fontSize: 12, marginTop: 4 },
  section: { fontSize: 18, fontWeight: "800", marginTop: 6, letterSpacing: -0.2 },
  sectionHint: { fontSize: 13, lineHeight: 18, marginTop: -8 },
  planLink: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingsCard: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, overflow: "hidden" },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLast: { borderBottomWidth: 0 },
  dangerRow: { borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "800" },
  rowDetail: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  securityCard: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  securityHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  securityDetail: { fontSize: 12, lineHeight: 18 },
  securityPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  securityPillWrap: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  securityPill: { fontSize: 12, fontWeight: "800" },
  reminderCard: { borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  capabilityCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 8 },
  privacyLink: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 10 },
  privacyText: { fontSize: 14, fontWeight: "800" },
  sheetScrim: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 22, gap: 12 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  timeoutOption: { borderWidth: 1, borderRadius: 16, padding: 14 },
  sheetCancel: { alignItems: "center", paddingVertical: 10 },
  pressed: { opacity: 0.78 },
});
