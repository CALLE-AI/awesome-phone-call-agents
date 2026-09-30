import type { AppLanguage } from "@/lib/language";
import type { OfflineReadinessState } from "@/lib/offline-readiness";

type OfflineCopy = {
  title: string;
  ready: string;
  queued: string;
  retrying: string;
  online: string;
  unknown: string;
  pending: (count: number) => string;
  oldest: (age: string) => string;
  continueOffline: string;
  retryWhenConnected: string;
  reviewFailed: string;
};

const english: OfflineCopy = {
  title: "Works offline",
  ready: "You can keep recording care safely without internet.",
  queued: "Your local work is saved and waiting to sync.",
  retrying: "Your saved work will retry when a connection is available.",
  online: "Connection available; saved work can sync now.",
  unknown: "Connection status is unknown; local work remains protected.",
  pending: (count) => `${count} item${count === 1 ? "" : "s"} waiting to sync`,
  oldest: (age) => `Oldest saved work: ${age}`,
  continueOffline: "Continue offline",
  retryWhenConnected: "Retry when connected",
  reviewFailed: "Review items that need attention",
};

const copyByLanguage: Record<AppLanguage, OfflineCopy> = {
  en: english,
  bn: { title: "অফলাইনে কাজ করে", ready: "ইন্টারনেট ছাড়াই নিরাপদে যত্নের তথ্য নিন।", queued: "আপনার লোকাল কাজ সংরক্ষিত এবং সিঙ্কের অপেক্ষায় আছে।", retrying: "সংযোগ পাওয়া গেলে সংরক্ষিত কাজ আবার চেষ্টা করবে।", online: "সংযোগ পাওয়া গেছে; সংরক্ষিত কাজ এখন সিঙ্ক হতে পারে।", unknown: "সংযোগের অবস্থা জানা নেই; লোকাল কাজ সুরক্ষিত আছে।", pending: (count) => `${count}টি কাজ সিঙ্কের অপেক্ষায়`, oldest: (age) => `সবচেয়ে পুরোনো কাজ: ${age}`, continueOffline: "অফলাইনে চালিয়ে যান", retryWhenConnected: "সংযোগ হলে আবার চেষ্টা করুন", reviewFailed: "মনোযোগ দরকার এমন কাজ দেখুন" },
  hi: { title: "ऑफलाइन काम करता है", ready: "इंटरनेट के बिना भी देखभाल की जानकारी सुरक्षित रूप से दर्ज करें।", queued: "आपका लोकल काम सुरक्षित है और सिंक का इंतज़ार कर रहा है।", retrying: "कनेक्शन मिलने पर आपका सुरक्षित काम फिर सिंक होगा।", online: "कनेक्शन उपलब्ध है; सुरक्षित काम अब सिंक हो सकता है।", unknown: "कनेक्शन की स्थिति अज्ञात है; लोकल काम सुरक्षित है।", pending: (count) => `${count} काम सिंक होने की प्रतीक्षा में`, oldest: (age) => `सबसे पुराना सुरक्षित काम: ${age}`, continueOffline: "ऑफलाइन जारी रखें", retryWhenConnected: "कनेक्शन मिलने पर फिर कोशिश करें", reviewFailed: "ध्यान चाहने वाले काम देखें" },
  ur: { title: "آف لائن کام کرتا ہے", ready: "انٹرنیٹ کے بغیر بھی نگہداشت کی معلومات محفوظ طور پر درج کریں۔", queued: "آپ کا مقامی کام محفوظ ہے اور ہم وقت سازی کا منتظر ہے۔", retrying: "کنکشن دستیاب ہونے پر محفوظ کام دوبارہ ہم وقت ہو جائے گا۔", online: "کنکشن دستیاب ہے؛ محفوظ کام اب ہم وقت ہو سکتا ہے۔", unknown: "کنکشن کی حالت معلوم نہیں؛ مقامی کام محفوظ ہے۔", pending: (count) => `${count} کام ہم وقت سازی کے منتظر ہیں`, oldest: (age) => `قدیم ترین محفوظ کام: ${age}`, continueOffline: "آف لائن جاری رکھیں", retryWhenConnected: "کنکشن پر دوبارہ کوشش کریں", reviewFailed: "توجہ کے محتاج کام دیکھیں" },
  ta: { title: "ஆஃப்லைனிலும் செயல்படும்", ready: "இணையம் இல்லாமலும் பராமரிப்பு தகவல்களை பாதுகாப்பாக பதிவு செய்யலாம்.", queued: "உங்கள் உள்ளூர் பணி சேமிக்கப்பட்டு ஒத்திசைவுக்காக காத்திருக்கிறது.", retrying: "இணைப்பு கிடைத்ததும் சேமிக்கப்பட்ட பணி மீண்டும் முயற்சிக்கப்படும்.", online: "இணைப்பு உள்ளது; சேமிக்கப்பட்ட பணியை இப்போது ஒத்திசைக்கலாம்.", unknown: "இணைப்பு நிலை தெரியவில்லை; உள்ளூர் பணி பாதுகாப்பாக உள்ளது.", pending: (count) => `${count} பணி ஒத்திசைவுக்காக காத்திருக்கிறது`, oldest: (age) => `பழைய சேமிக்கப்பட்ட பணி: ${age}`, continueOffline: "ஆஃப்லைனில் தொடரவும்", retryWhenConnected: "இணைப்பு கிடைத்ததும் மீண்டும் முயற்சிக்கவும்", reviewFailed: "கவனம் தேவைப்படும் பணிகளைப் பார்க்கவும்" },
  te: { title: "ఆఫ్‌లైన్‌లో పనిచేస్తుంది", ready: "ఇంటర్నెట్ లేకపోయినా సంరక్షణ సమాచారాన్ని భద్రంగా నమోదు చేయవచ్చు.", queued: "మీ స్థానిక పని భద్రంగా సేవ్ అయి సింక్ కోసం వేచి ఉంది.", retrying: "కనెక్షన్ వచ్చినప్పుడు సేవ్ చేసిన పని మళ్లీ ప్రయత్నించబడుతుంది.", online: "కనెక్షన్ ఉంది; సేవ్ చేసిన పనిని ఇప్పుడు సింక్ చేయవచ్చు.", unknown: "కనెక్షన్ స్థితి తెలియదు; స్థానిక పని భద్రంగా ఉంది.", pending: (count) => `${count} పని సింక్ కోసం వేచి ఉంది`, oldest: (age) => `పాత సేవ్ చేసిన పని: ${age}`, continueOffline: "ఆఫ్‌లైన్‌లో కొనసాగించండి", retryWhenConnected: "కనెక్షన్ వచ్చినప్పుడు మళ్లీ ప్రయత్నించండి", reviewFailed: "శ్రద్ధ అవసరమైన పనులను చూడండి" },
};

export function getOfflineCopy(language: AppLanguage): OfflineCopy {
  return copyByLanguage[language] ?? english;
}

export function getOfflineStateMessage(language: AppLanguage, state: OfflineReadinessState): string {
  const copy = getOfflineCopy(language);
  return state === "ready" ? copy.ready : state === "queued" ? copy.queued : state === "retrying" ? copy.retrying : state === "online" ? copy.online : copy.unknown;
}
