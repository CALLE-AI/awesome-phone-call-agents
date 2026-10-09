import type { AppLanguage } from "@/lib/language";

export type CapabilityLanguage = AppLanguage;

export type NativeCapabilityState = {
  biometricAvailable: boolean;
  secureStorageAvailable: boolean;
  backgroundTaskAvailable: boolean;
  backgroundTaskRegistered: boolean;
};

type CapabilityCopy = {
  backgroundLabel: string;
  backgroundReady: string;
  backgroundOpen: string;
  storageReady: string;
  storageFallback: string;
  biometricReady: string;
  biometricUnavailable: string;
};

const capabilityCopyByLanguage: Record<AppLanguage, CapabilityCopy> = {
  en: {
    backgroundLabel: "Background sync",
    backgroundReady: "Ready when the device allows background work",
    backgroundOpen: "Available when the app is open",
    storageReady: "Secure local storage is active",
    storageFallback: "Protected storage fallback is active",
    biometricReady: "Biometric unlock is ready",
    biometricUnavailable: "Biometric unlock is unavailable",
  },
  bn: {
    backgroundLabel: "ব্যাকগ্রাউন্ড সিঙ্ক",
    backgroundReady: "ডিভাইস ব্যাকগ্রাউন্ড কাজের অনুমতি দিলে প্রস্তুত",
    backgroundOpen: "অ্যাপ খোলা থাকলে ব্যবহার করা যাবে",
    storageReady: "সুরক্ষিত লোকাল স্টোরেজ চালু আছে",
    storageFallback: "সুরক্ষিত স্টোরেজের বিকল্প চালু আছে",
    biometricReady: "বায়োমেট্রিক আনলক প্রস্তুত",
    biometricUnavailable: "বায়োমেট্রিক পাওয়া যায়নি",
  },
  hi: {
    backgroundLabel: "बैकग्राउंड सिंक",
    backgroundReady: "डिवाइस बैकग्राउंड काम की अनुमति दे तो तैयार",
    backgroundOpen: "ऐप खुला होने पर उपलब्ध",
    storageReady: "सुरक्षित लोकल स्टोरेज सक्रिय है",
    storageFallback: "सुरक्षित स्टोरेज का वैकल्पिक तरीका सक्रिय है",
    biometricReady: "बायोमेट्रिक अनलॉक तैयार है",
    biometricUnavailable: "बायोमेट्रिक अनलॉक उपलब्ध नहीं है",
  },
  ur: {
    backgroundLabel: "پس منظر کی ہم وقت سازی",
    backgroundReady: "جب ڈیوائس پس منظر کے کام کی اجازت دے تو تیار",
    backgroundOpen: "ایپ کھلی ہونے پر دستیاب",
    storageReady: "محفوظ مقامی اسٹوریج فعال ہے",
    storageFallback: "محفوظ اسٹوریج کا متبادل فعال ہے",
    biometricReady: "بایومیٹرک ان لاک تیار ہے",
    biometricUnavailable: "بایومیٹرک ان لاک دستیاب نہیں",
  },
  ta: {
    backgroundLabel: "பின்னணி ஒத்திசைவு",
    backgroundReady: "சாதனம் பின்னணி பணியை அனுமதிக்கும்போது தயார்",
    backgroundOpen: "பயன்பாடு திறந்திருக்கும் போது கிடைக்கும்",
    storageReady: "பாதுகாப்பான உள்ளூர் சேமிப்பு செயல்பாட்டில் உள்ளது",
    storageFallback: "பாதுகாப்பான சேமிப்பகத்தின் மாற்று செயல்பாட்டில் உள்ளது",
    biometricReady: "பயோமெட்ரிக் திறப்பு தயார்",
    biometricUnavailable: "பயோமெட்ரிக் திறப்பு கிடைக்கவில்லை",
  },
  te: {
    backgroundLabel: "బ్యాక్‌గ్రౌండ్ సింక్",
    backgroundReady: "పరికరం బ్యాక్‌గ్రౌండ్ పనిని అనుమతించినప్పుడు సిద్ధంగా ఉంటుంది",
    backgroundOpen: "యాప్ తెరిచి ఉన్నప్పుడు అందుబాటులో ఉంటుంది",
    storageReady: "సురక్షిత స్థానిక నిల్వ సక్రియంగా ఉంది",
    storageFallback: "సురక్షిత నిల్వ ప్రత్యామ్నాయం సక్రియంగా ఉంది",
    biometricReady: "బయోమెట్రిక్ అన్‌లాక్ సిద్ధంగా ఉంది",
    biometricUnavailable: "బయోమెట్రిక్ అన్‌లాక్ అందుబాటులో లేదు",
  },
};

export function getCapabilitySummary(state: NativeCapabilityState, language: CapabilityLanguage) {
  const copy = capabilityCopyByLanguage[language] ?? capabilityCopyByLanguage.en;
  return {
    backgroundLabel: copy.backgroundLabel,
    background: state.backgroundTaskAvailable && state.backgroundTaskRegistered ? copy.backgroundReady : copy.backgroundOpen,
    storage: state.secureStorageAvailable ? copy.storageReady : copy.storageFallback,
    biometric: state.biometricAvailable ? copy.biometricReady : copy.biometricUnavailable,
  };
}
