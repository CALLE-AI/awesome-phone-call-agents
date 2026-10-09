const fs = require("fs");

// --- index.tsx: fix broken guidance override ---
{
  const path = "app/(tabs)/index.tsx";
  let text = fs.readFileSync(path, "utf8");
  const before = text;
  text = text.replace(
    /setCallSheetTitle\(copy\.syncDiagnosticTitle\);\s*setGuidanceBodyOverride\(diagnostic\);\s*setGuidanceSheetOpen\(true\);/g,
    'showToast(diagnostic, "neutral");',
  );
  text = text.replace(
    /setGuidanceBodyOverride\(diagnostic\);\s*setGuidanceSheetOpen\(true\);/g,
    'showToast(diagnostic, "neutral");',
  );
  if (text !== before) {
    fs.writeFileSync(path, text);
    console.log("index: fixed sync diagnostic");
  } else {
    console.log("index: no sync diagnostic change needed");
  }
}

// --- care-preferences.ts ---
fs.writeFileSync(
  "lib/care-preferences.ts",
  `import AsyncStorage from "@react-native-async-storage/async-storage";

const CARE_PREFS_KEY = "call-aunty/care-preferences";

export type CarePreferences = {
  remindersEnabled: boolean;
  sharedPhonePrivacy: boolean;
};

export const DEFAULT_CARE_PREFERENCES: CarePreferences = {
  remindersEnabled: true,
  sharedPhonePrivacy: true,
};

export function parseCarePreferences(value: string | null): CarePreferences {
  if (!value) return DEFAULT_CARE_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<CarePreferences>;
    return {
      remindersEnabled: parsed.remindersEnabled !== false,
      sharedPhonePrivacy: parsed.sharedPhonePrivacy !== false,
    };
  } catch {
    return DEFAULT_CARE_PREFERENCES;
  }
}

export async function loadCarePreferences(): Promise<CarePreferences> {
  try {
    return parseCarePreferences(await AsyncStorage.getItem(CARE_PREFS_KEY));
  } catch {
    return DEFAULT_CARE_PREFERENCES;
  }
}

export async function saveCarePreferences(prefs: CarePreferences): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CARE_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
`,
);
console.log("care-preferences written");

// --- app-copy shared phone off details ---
{
  const path = "lib/app-copy.ts";
  let text = fs.readFileSync(path, "utf8");
  if (!text.includes("sharedPhoneOffDetail")) {
    const pairs = [
      ['sharedPhoneDetail: "Neutral greetings on",', 'sharedPhoneDetail: "Neutral greetings on",\n  sharedPhoneOffDetail: "Neutral greetings off",'],
      ['sharedPhoneDetail: "নিরপেক্ষ শুভেচ্ছা চালু",', 'sharedPhoneDetail: "নিরপেক্ষ শুভেচ্ছা চালু",\n  sharedPhoneOffDetail: "নিরপেক্ষ শুভেচ্ছা বন্ধ",'],
      ['sharedPhoneDetail: "तटस्थ अभिवादन चालू",', 'sharedPhoneDetail: "तटस्थ अभिवादन चालू",\n  sharedPhoneOffDetail: "तटस्थ अभिवादन बंद",'],
      ['sharedPhoneDetail: "غیر جانب دار سلام فعال",', 'sharedPhoneDetail: "غیر جانب دار سلام فعال",\n  sharedPhoneOffDetail: "غیر جانب دار سلام بند",'],
    ];
    for (const [from, to] of pairs) {
      if (text.includes(from) && !text.includes(to)) text = text.replace(from, to);
    }
    fs.writeFileSync(path, text);
    console.log("app-copy: added sharedPhoneOffDetail");
  } else {
    console.log("app-copy: sharedPhoneOffDetail already present");
  }
}

// --- settings.tsx ---
{
  const path = "app/(tabs)/settings.tsx";
  let text = fs.readFileSync(path, "utf8");

  if (!text.includes("@/lib/care-preferences")) {
    // Insert after last import
    const lastImport = text.lastIndexOf("\nimport ");
    const end = text.indexOf("\n", lastImport + 1);
    text =
      text.slice(0, end + 1) +
      'import { DEFAULT_CARE_PREFERENCES, loadCarePreferences, saveCarePreferences, type CarePreferences } from "@/lib/care-preferences";\n' +
      text.slice(end + 1);
  }

  if (!text.includes("carePreferences")) {
    text = text.replace(
      "const [privacyLockEnabled, setPrivacyLockEnabled] = useState(false);",
      "const [privacyLockEnabled, setPrivacyLockEnabled] = useState(false);\n  const [carePreferences, setCarePreferences] = useState<CarePreferences>(DEFAULT_CARE_PREFERENCES);",
    );
  }

  if (!text.includes("loadCarePreferences()")) {
    text = text.replace(
      "void loadPrivacyLock().then(setPrivacyLockEnabled).catch(() => setPrivacyLockEnabled(false));",
      "void loadPrivacyLock().then(setPrivacyLockEnabled).catch(() => setPrivacyLockEnabled(false));\n    void loadCarePreferences().then(setCarePreferences).catch(() => setCarePreferences(DEFAULT_CARE_PREFERENCES));",
    );
  }

  if (!text.includes("toggleCarePreference")) {
    const marker = text.match(/async function toggle[A-Za-z]+\(\) \{/);
    if (marker) {
      text = text.replace(
        marker[0],
        `async function toggleCarePreference(key: keyof CarePreferences) {
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

  ${marker[0]}`,
      );
    }
  }

  // Shared phone: ensure toggle has value + handler
  if (text.includes("sharedPhoneLabel") && !text.includes('toggleCarePreference("sharedPhonePrivacy")')) {
    text = text.replace(
      /title=\{getSecurityCopy\(language\)\.sharedPhoneLabel\} detail=\{copy\.sharedPhoneDetail\}/g,
      'title={getSecurityCopy(language).sharedPhoneLabel} detail={carePreferences.sharedPhonePrivacy ? copy.sharedPhoneDetail : (copy.sharedPhoneOffDetail ?? copy.sharedPhoneDetail)}',
    );
    text = text.replace(
      /(sharedPhoneLabel\} detail=\{carePreferences\.sharedPhonePrivacy[^\}]+\} colors=\{colors\} tints=\{tints\} )toggle( \/>)/,
      '$1toggle toggleValue={carePreferences.sharedPhonePrivacy} onPress={() => void toggleCarePreference("sharedPhonePrivacy")}$2',
    );
  }

  // Reminders switch
  if (text.includes("remindersTitle") && !text.includes('toggleCarePreference("remindersEnabled")')) {
    text = text.replace(
      /accessibilityLabel=\{getSecurityCopy\(language\)\.remindersTitle\} value onValueChange=\{\(\) => Alert\.alert\(copy\.remindersAlertTitle, copy\.remindersAlertBody\)\}/g,
      'accessibilityLabel={getSecurityCopy(language).remindersTitle} value={carePreferences.remindersEnabled} onValueChange={() => void toggleCarePreference("remindersEnabled")}',
    );
  }

  // SettingRow: add toggleValue support
  if (!text.includes("toggleValue")) {
    text = text.replace(
      /function SettingRow\(\{ icon, title, detail, colors, tints, onPress, toggle, last \}/,
      "function SettingRow({ icon, title, detail, colors, tints, onPress, toggle, toggleValue = true, last }",
    );
    text = text.replace(
      /toggle\?: boolean; last\?: boolean \}/,
      "toggle?: boolean; toggleValue?: boolean; last?: boolean }",
    );
    text = text.replace(
      /\{toggle \? <Switch accessibilityRole="switch" accessibilityLabel=\{title\} value onValueChange=\{onPress\}/g,
      '{toggle ? <Switch accessibilityRole="switch" accessibilityLabel={title} value={toggleValue} onValueChange={onPress}',
    );
  }

  // Low-data toggle should pass current value too
  text = text.replace(
    /title=\{getLowDataCopy\(language\)\.label\} detail=\{lowDataMode\.enabled \? getLowDataCopy\(language\)\.enabled : getLowDataCopy\(language\)\.disabled\} colors=\{colors\} tints=\{tints\} toggle onPress=\{\(\) => void toggleLowDataMode\(\)\}/g,
    'title={getLowDataCopy(language).label} detail={lowDataMode.enabled ? getLowDataCopy(language).enabled : getLowDataCopy(language).disabled} colors={colors} tints={tints} toggle toggleValue={lowDataMode.enabled} onPress={() => void toggleLowDataMode()}',
  );

  fs.writeFileSync(path, text);
  console.log("settings patched");
}

// --- queue.tsx empty-state keys ---
{
  const path = "app/(tabs)/queue.tsx";
  if (fs.existsSync(path)) {
    let text = fs.readFileSync(path, "utf8");
    // Prefer queueClear / queueClearBody from app-copy
    text = text.replace(/\{copy\.queueClear\}/g, "{copy.queueClear}");
    text = text.replace(/\{copy\.queueClearBody\}/g, "{copy.queueClearBody}");
    text = text.replace(/\{copy\.queueClear\}/g, "{copy.queueClear}");
    text = text.replace(/\{copy\.queueClearBody\}/g, "{copy.queueClearBody}");
    fs.writeFileSync(path, text);
    console.log("queue checked");
  }
}

console.log("done");
