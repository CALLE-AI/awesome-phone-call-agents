import type { AppLanguage } from "@/lib/language";

function toLocalizedDigits(value: number, language: AppLanguage) {
  const digits = language === "bn" ? "০১২৩৪৫৬৭৮৯" : language === "ur" ? "۰۱۲۳۴۵۶۷۸۹" : "0123456789";
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

type ProtectedCopy = {
  locked: string;
  cooldown: (seconds: number) => string;
  biometricReady: string;
  biometricUnavailable: string;
  passcodeReady: string;
  passcodeMissing: string;
  protectedStorage: string;
  lockTitle: string;
  lockSubtitle: string;
  unlock: string;
  wait: string;
  cancel: string;
  timeoutTitle: string;
  timeoutSubtitle: string;
  selected: string;
  tapToChoose: string;
  securityTitle: string;
  settingsTitle: string;
  securitySection: string;
  remindersSection: string;
  languageLabel: string;
  safeContactLabel: string;
  sharedPhoneLabel: string;
  autoLockLabel: string;
  passcodeFallbackLabel: string;
  resetPasscode: string;
  privacyPromise: string;
  remindersTitle: string;
  remindersDetail: string;
  backgroundSyncLabel: string;
  backgroundSyncReady: string;
  backgroundSyncUnavailable: string;
  secureStorageReady: string;
};

const englishCopy: ProtectedCopy = {
  locked: "Your protected information is safe.",
  cooldown: (seconds) => `Try again in ${seconds} seconds.`,
  biometricReady: "Biometric unlock is ready",
  biometricUnavailable: "Biometric unlock is unavailable",
  passcodeReady: "Passcode backup is enabled",
  passcodeMissing: "Passcode backup is not set",
  protectedStorage: "Protected storage is active on this device",
  lockTitle: "Unlock protected records",
  lockSubtitle: "Use your passcode if biometric unlock is unavailable.",
  unlock: "Unlock",
  wait: "Wait",
  cancel: "Cancel",
  timeoutTitle: "Auto-lock timeout",
  timeoutSubtitle: "Choose how long protected records can remain open after backgrounding.",
  selected: "Selected",
  tapToChoose: "Tap to choose",
  securityTitle: "Privacy protection",
  settingsTitle: "Your preferences",
  securitySection: "Security",
  remindersSection: "Reminders",
  languageLabel: "Language",
  safeContactLabel: "Safe contact window",
  sharedPhoneLabel: "Shared-phone privacy",
  autoLockLabel: "Auto-lock timeout",
  passcodeFallbackLabel: "Passcode fallback",
  resetPasscode: "Reset passcode fallback",
  privacyPromise: "Read the privacy promise",
  remindersTitle: "Care reminders are on",
  remindersDetail: "Aunty will remind you before your next care contact.",
  backgroundSyncLabel: "Background sync",
  backgroundSyncReady: "Ready when the device allows background work",
  backgroundSyncUnavailable: "Available when the app is open",
  secureStorageReady: "Secure local storage is active",
};

const banglaCopy: ProtectedCopy = {
  locked: "আপনার গোপন তথ্য সুরক্ষিত আছে।",
  cooldown: (seconds) => `অনুগ্রহ করে ${toLocalizedDigits(seconds, "bn")} সেকেন্ড পরে আবার চেষ্টা করুন।`,
  biometricReady: "বায়োমেট্রিক আনলক প্রস্তুত",
  biometricUnavailable: "বায়োমেট্রিক পাওয়া যায়নি",
  passcodeReady: "পাসকোড ব্যাকআপ চালু আছে",
  passcodeMissing: "পাসকোড ব্যাকআপ সেট করা নেই",
  protectedStorage: "এই ডিভাইসে সুরক্ষিত স্টোরেজ ব্যবহার হচ্ছে",
  lockTitle: "সুরক্ষিত তথ্য আনলক করুন",
  lockSubtitle: "বায়োমেট্রিক কাজ না করলে পাসকোড ব্যবহার করুন।",
  unlock: "আনলক করুন",
  wait: "অপেক্ষা করুন",
  cancel: "বাতিল",
  timeoutTitle: "অটো-লক সময়",
  timeoutSubtitle: "অ্যাপ বন্ধ হলে সুরক্ষিত তথ্য কতক্ষণ খোলা থাকবে তা বেছে নিন।",
  selected: "নির্বাচিত",
  tapToChoose: "বেছে নিতে চাপুন",
  securityTitle: "গোপনীয়তা সুরক্ষা",
  settingsTitle: "আপনার পছন্দ",
  securitySection: "নিরাপত্তা",
  remindersSection: "মনে করিয়ে দেওয়া",
  languageLabel: "ভাষা",
  safeContactLabel: "নিরাপদ যোগাযোগের সময়",
  sharedPhoneLabel: "শেয়ার করা ফোনের গোপনীয়তা",
  autoLockLabel: "অটো-লক সময়",
  passcodeFallbackLabel: "পাসকোড ব্যাকআপ",
  resetPasscode: "পাসকোড ব্যাকআপ রিসেট করুন",
  privacyPromise: "গোপনীয়তার প্রতিশ্রুতি পড়ুন",
  remindersTitle: "যত্নের মনে করিয়ে দেওয়া চালু আছে",
  remindersDetail: "পরবর্তী যোগাযোগের আগে আন্টি আপনাকে মনে করিয়ে দেবেন।",
  backgroundSyncLabel: "ব্যাকগ্রাউন্ড সিঙ্ক",
  backgroundSyncReady: "ডিভাইস ব্যাকগ্রাউন্ড কাজের অনুমতি দিলে প্রস্তুত",
  backgroundSyncUnavailable: "অ্যাপ খোলা থাকলে ব্যবহার করা যাবে",
  secureStorageReady: "সুরক্ষিত লোকাল স্টোরেজ চালু আছে",
};

const hindiCopy: ProtectedCopy = {
  locked: "आपकी सुरक्षित जानकारी सुरक्षित है।",
  cooldown: (seconds) => `${toLocalizedDigits(seconds, "hi")} सेकंड बाद फिर कोशिश करें।`,
  biometricReady: "बायोमेट्रिक अनलॉक तैयार है",
  biometricUnavailable: "बायोमेट्रिक अनलॉक उपलब्ध नहीं है",
  passcodeReady: "पासकोड बैकअप चालू है",
  passcodeMissing: "पासकोड बैकअप सेट नहीं है",
  protectedStorage: "इस डिवाइस पर सुरक्षित स्टोरेज सक्रिय है",
  lockTitle: "सुरक्षित रिकॉर्ड अनलॉक करें",
  lockSubtitle: "बायोमेट्रिक अनलॉक उपलब्ध न हो तो पासकोड इस्तेमाल करें।",
  unlock: "अनलॉक करें",
  wait: "प्रतीक्षा करें",
  cancel: "रद्द करें",
  timeoutTitle: "ऑटो-लॉक समय",
  timeoutSubtitle: "बैकग्राउंड में जाने के बाद सुरक्षित रिकॉर्ड कितनी देर खुले रहें, चुनें।",
  selected: "चयनित",
  tapToChoose: "चुनने के लिए टैप करें",
  securityTitle: "गोपनीयता सुरक्षा",
  settingsTitle: "आपकी पसंद",
  securitySection: "सुरक्षा",
  remindersSection: "याद दिलाने वाले संदेश",
  languageLabel: "भाषा",
  safeContactLabel: "सुरक्षित संपर्क समय",
  sharedPhoneLabel: "साझा फोन की गोपनीयता",
  autoLockLabel: "ऑटो-लॉक समय",
  passcodeFallbackLabel: "पासकोड बैकअप",
  resetPasscode: "पासकोड बैकअप रीसेट करें",
  privacyPromise: "गोपनीयता वादा पढ़ें",
  remindersTitle: "देखभाल की याद दिलाने वाली सुविधा चालू है",
  remindersDetail: "अगले स्वास्थ्य संपर्क से पहले आंटी आपको याद दिलाएंगी।",
  backgroundSyncLabel: "बैकग्राउंड सिंक",
  backgroundSyncReady: "डिवाइस बैकग्राउंड काम की अनुमति दे तो तैयार",
  backgroundSyncUnavailable: "ऐप खुला होने पर उपलब्ध",
  secureStorageReady: "सुरक्षित लोकल स्टोरेज सक्रिय है",
};

const urduCopy: ProtectedCopy = {
  locked: "آپ کی محفوظ معلومات محفوظ ہیں۔",
  cooldown: (seconds) => `${toLocalizedDigits(seconds, "ur")} سیکنڈ بعد دوبارہ کوشش کریں۔`,
  biometricReady: "بایومیٹرک ان لاک تیار ہے",
  biometricUnavailable: "بایومیٹرک ان لاک دستیاب نہیں",
  passcodeReady: "پاس کوڈ بیک اپ فعال ہے",
  passcodeMissing: "پاس کوڈ بیک اپ مقرر نہیں ہے",
  protectedStorage: "اس ڈیوائس پر محفوظ اسٹوریج فعال ہے",
  lockTitle: "محفوظ ریکارڈز ان لاک کریں",
  lockSubtitle: "اگر بایومیٹرک ان لاک دستیاب نہ ہو تو پاس کوڈ استعمال کریں۔",
  unlock: "ان لاک کریں",
  wait: "انتظار کریں",
  cancel: "منسوخ کریں",
  timeoutTitle: "خودکار لاک کا وقت",
  timeoutSubtitle: "پس منظر میں جانے کے بعد محفوظ ریکارڈز کتنی دیر کھلے رہیں، منتخب کریں۔",
  selected: "منتخب",
  tapToChoose: "منتخب کرنے کے لیے ٹیپ کریں",
  securityTitle: "رازداری کا تحفظ",
  settingsTitle: "آپ کی ترجیحات",
  securitySection: "سکیورٹی",
  remindersSection: "یاد دہانیاں",
  languageLabel: "زبان",
  safeContactLabel: "محفوظ رابطے کا وقت",
  sharedPhoneLabel: "مشترکہ فون کی رازداری",
  autoLockLabel: "خودکار لاک کا وقت",
  passcodeFallbackLabel: "پاس کوڈ بیک اپ",
  resetPasscode: "پاس کوڈ بیک اپ ری سیٹ کریں",
  privacyPromise: "رازداری کا وعدہ پڑھیں",
  remindersTitle: "نگہداشت کی یاد دہانیاں فعال ہیں",
  remindersDetail: "آپ کے اگلے نگہداشت رابطے سے پہلے آنٹی آپ کو یاد دلائیں گی۔",
  backgroundSyncLabel: "پس منظر کی ہم وقت سازی",
  backgroundSyncReady: "جب ڈیوائس پس منظر کے کام کی اجازت دے تو تیار",
  backgroundSyncUnavailable: "ایپ کھلی ہونے پر دستیاب",
  secureStorageReady: "محفوظ مقامی اسٹوریج فعال ہے",
};

const tamilCopy: ProtectedCopy = { ...englishCopy, locked: "உங்கள் பாதுகாக்கப்பட்ட தகவல்கள் பாதுகாப்பாக உள்ளன.", securityTitle: "தனியுரிமை பாதுகாப்பு", settingsTitle: "உங்கள் விருப்பங்கள்", securitySection: "பாதுகாப்பு", remindersSection: "நினைவூட்டல்கள்", languageLabel: "மொழி", passcodeFallbackLabel: "கடவுக்குறியீடு காப்புப்பிரதி", backgroundSyncLabel: "பின்னணி ஒத்திசைவு", backgroundSyncReady: "சாதனம் பின்னணி பணியை அனுமதிக்கும்போது தயார்", backgroundSyncUnavailable: "பயன்பாடு திறந்திருக்கும் போது கிடைக்கும்", secureStorageReady: "பாதுகாப்பான உள்ளூர் சேமிப்பு செயல்பாட்டில் உள்ளது" };
const teluguCopy: ProtectedCopy = { ...englishCopy, locked: "మీ రక్షిత సమాచారం సురక్షితంగా ఉంది.", securityTitle: "గోప్యతా రక్షణ", settingsTitle: "మీ ప్రాధాన్యతలు", securitySection: "భద్రత", remindersSection: "గుర్తుచేయింపులు", languageLabel: "భాష", passcodeFallbackLabel: "పాస్‌కోడ్ బ్యాకప్", backgroundSyncLabel: "బ్యాక్‌గ్రౌండ్ సింక్", backgroundSyncReady: "పరికరం బ్యాక్‌గ్రౌండ్ పనిని అనుమతించినప్పుడు సిద్ధంగా ఉంటుంది", backgroundSyncUnavailable: "యాప్ తెరిచి ఉన్నప్పుడు అందుబాటులో ఉంటుంది", secureStorageReady: "సురక్షిత స్థానిక నిల్వ సక్రియంగా ఉంది" };
const copyByLanguage: Record<AppLanguage, ProtectedCopy> = { bn: banglaCopy, en: englishCopy, hi: hindiCopy, ur: urduCopy, ta: tamilCopy, te: teluguCopy };

export function getSecurityCopy(language: AppLanguage): ProtectedCopy {
  return copyByLanguage[language] ?? englishCopy;
}

export const securityCopy = banglaCopy;

export function getSecurityStatusSummary({ passcodeConfigured, biometricAvailable, locked, language = "bn" }: { passcodeConfigured: boolean; biometricAvailable: boolean; locked: boolean; language?: AppLanguage }) {
  const copy = getSecurityCopy(language);
  if (locked) return copy.locked;
  if (passcodeConfigured && biometricAvailable) {
    return language === "bn" ? "বায়োমেট্রিক এবং পাসকোড ব্যাকআপ চালু আছে" : language === "hi" ? "बायोमेट्रिक और पासकोड बैकअप चालू हैं" : language === "ur" ? "بایومیٹرک اور پاس کوڈ بیک اپ فعال ہیں" : "Biometric and passcode backup are enabled";
  }
  if (passcodeConfigured) return copy.passcodeReady;
  if (biometricAvailable) return copy.biometricReady;
  return language === "bn" ? "একটি পাসকোড ব্যাকআপ সেট করুন" : language === "hi" ? "पासकोड बैकअप सेट करें" : language === "ur" ? "پاس کوڈ بیک اپ مقرر کریں" : "Set a passcode backup";
}
