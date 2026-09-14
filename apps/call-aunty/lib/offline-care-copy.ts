import type { AppLanguage } from "@/lib/language";
import type { OfflineCareFreshness } from "@/lib/offline-care-snapshot";

type OfflineCareCopy = { title: string; available: string; stale: string; missing: string; refresh: string; saved: string; unavailable: string };

const copyByLanguage: Record<AppLanguage, OfflineCareCopy> = {
  en: { title: "Offline care plan", available: "This care plan is saved on this device.", stale: "This saved care plan may be out of date. Refresh when connected.", missing: "Care plan is ready for offline use after it is saved once.", refresh: "Save for offline use", saved: "Care plan saved for offline use", unavailable: "Could not save the care plan. Existing local work is protected." },
  bn: { title: "অফলাইন যত্নের পরিকল্পনা", available: "এই যত্নের পরিকল্পনা ডিভাইসে সংরক্ষিত আছে।", stale: "সংরক্ষিত পরিকল্পনাটি পুরোনো হতে পারে। সংযোগ পেলে রিফ্রেশ করুন।", missing: "একবার সংরক্ষণ করলে যত্নের পরিকল্পনা অফলাইনে ব্যবহার করা যাবে।", refresh: "অফলাইনের জন্য সংরক্ষণ করুন", saved: "অফলাইনের জন্য যত্নের পরিকল্পনা সংরক্ষিত হয়েছে", unavailable: "যত্নের পরিকল্পনা সংরক্ষণ করা যায়নি। আগের লোকাল কাজ সুরক্ষিত আছে।" },
  hi: { title: "ऑफलाइन देखभाल योजना", available: "यह देखभाल योजना इस डिवाइस पर सुरक्षित है।", stale: "यह सुरक्षित योजना पुरानी हो सकती है। कनेक्शन मिलने पर रिफ्रेश करें।", missing: "एक बार सहेजने के बाद देखभाल योजना ऑफलाइन उपलब्ध रहेगी।", refresh: "ऑफलाइन उपयोग के लिए सहेजें", saved: "देखभाल योजना ऑफलाइन उपयोग के लिए सहेजी गई", unavailable: "देखभाल योजना सहेजी नहीं जा सकी। मौजूदा लोकल काम सुरक्षित है।" },
  ur: { title: "آف لائن نگہداشت کا منصوبہ", available: "یہ نگہداشت کا منصوبہ اس ڈیوائس پر محفوظ ہے۔", stale: "یہ محفوظ منصوبہ پرانا ہو سکتا ہے۔ کنکشن ملنے پر تازہ کریں۔", missing: "ایک بار محفوظ ہونے کے بعد نگہداشت کا منصوبہ آف لائن دستیاب رہے گا۔", refresh: "آف لائن استعمال کے لیے محفوظ کریں", saved: "نگہداشت کا منصوبہ آف لائن استعمال کے لیے محفوظ ہو گیا", unavailable: "نگہداشت کا منصوبہ محفوظ نہیں ہو سکا۔ موجودہ مقامی کام محفوظ ہے۔" },
  ta: { title: "ஆஃப்லைன் பராமரிப்பு திட்டம்", available: "இந்த பராமரிப்பு திட்டம் இந்த சாதனத்தில் சேமிக்கப்பட்டுள்ளது.", stale: "சேமித்த திட்டம் பழையதாக இருக்கலாம். இணைப்பு கிடைத்ததும் புதுப்பிக்கவும்.", missing: "ஒருமுறை சேமித்த பிறகு பராமரிப்பு திட்டத்தை ஆஃப்லைனில் பயன்படுத்தலாம்.", refresh: "ஆஃப்லைன் பயன்பாட்டிற்காக சேமிக்கவும்", saved: "பராமரிப்பு திட்டம் ஆஃப்லைன் பயன்பாட்டிற்காக சேமிக்கப்பட்டது", unavailable: "பராமரிப்பு திட்டத்தை சேமிக்க முடியவில்லை. ஏற்கனவே உள்ள உள்ளூர் பணி பாதுகாப்பாக உள்ளது." },
  te: { title: "ఆఫ్‌లైన్ సంరక్షణ ప్రణాళిక", available: "ఈ సంరక్షణ ప్రణాళిక ఈ పరికరంలో సేవ్ చేయబడింది.", stale: "సేవ్ చేసిన ప్రణాళిక పాతదై ఉండవచ్చు. కనెక్షన్ వచ్చినప్పుడు రిఫ్రెష్ చేయండి.", missing: "ఒక్కసారి సేవ్ చేసిన తర్వాత సంరక్షణ ప్రణాళికను ఆఫ్‌లైన్‌లో ఉపయోగించవచ్చు.", refresh: "ఆఫ్‌లైన్ ఉపయోగం కోసం సేవ్ చేయండి", saved: "సంరక్షణ ప్రణాళిక ఆఫ్‌లైన్ ఉపయోగం కోసం సేవ్ చేయబడింది", unavailable: "సంరక్షణ ప్రణాళికను సేవ్ చేయలేకపోయాం. ఇప్పటికే ఉన్న స్థానిక పని భద్రంగా ఉంది." },
};

export function getOfflineCareCopy(language: AppLanguage): OfflineCareCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}

export function getOfflineCareMessage(language: AppLanguage, freshness: OfflineCareFreshness): string {
  const copy = getOfflineCareCopy(language);
  return freshness === "available" ? copy.available : freshness === "stale" ? copy.stale : copy.missing;
}
