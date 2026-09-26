import type { AppLanguage } from "@/lib/language";

type SyncTransferCopy = {
  confirmTitle: string;
  wifiBody: string;
  cellularBody: string;
  unknownBody: string;
  continue: string;
  cancel: string;
  saved: string;
  resume: (completed: number, total: number) => string;
};

const copyByLanguage: Record<AppLanguage, SyncTransferCopy> = {
  en: { confirmTitle: "Sync saved work?", wifiBody: "Wi-Fi is available. Send only saved queue metadata and follow-up records now?", cellularBody: "This connection may use mobile data. Continue only if you want to sync now.", unknownBody: "The connection type is unknown. Continue only if you want to sync now.", continue: "Sync now", cancel: "Not now", saved: "Local work remains saved on this device.", resume: (completed, total) => `Resumable sync: ${completed} of ${total} items prepared.` },
  bn: { confirmTitle: "সংরক্ষিত কাজ সিঙ্ক করবেন?", wifiBody: "ওয়াই-ফাই পাওয়া গেছে। শুধু সংরক্ষিত কিউ মেটাডেটা ও ফলো-আপ রেকর্ড এখন পাঠাবেন?", cellularBody: "এই সংযোগে মোবাইল ডেটা ব্যবহার হতে পারে। এখন সিঙ্ক করতে চাইলে চালিয়ে যান।", unknownBody: "সংযোগের ধরন জানা নেই। এখন সিঙ্ক করতে চাইলে চালিয়ে যান।", continue: "এখন সিঙ্ক করুন", cancel: "এখন নয়", saved: "লোকাল কাজ এই ডিভাইসে সংরক্ষিত থাকবে।", resume: (completed, total) => `পুনরায় চালানো সিঙ্ক: ${total}টির মধ্যে ${completed}টি কাজ প্রস্তুত।` },
  hi: { confirmTitle: "सहेजा हुआ काम सिंक करें?", wifiBody: "Wi-Fi उपलब्ध है। क्या केवल सहेजे गए कतार मेटाडेटा और फॉलो-अप रिकॉर्ड अभी भेजें?", cellularBody: "इस कनेक्शन में मोबाइल डेटा लग सकता है। अभी सिंक करना हो तभी आगे बढ़ें।", unknownBody: "कनेक्शन का प्रकार अज्ञात है। अभी सिंक करना हो तभी आगे बढ़ें।", continue: "अभी सिंक करें", cancel: "अभी नहीं", saved: "लोकल काम इसी डिवाइस पर सुरक्षित रहेगा।", resume: (completed, total) => `फिर से शुरू होने वाला सिंक: ${total} में से ${completed} काम तैयार हैं।` },
  ur: { confirmTitle: "محفوظ کام ہم وقت کریں؟", wifiBody: "وائی فائی دستیاب ہے۔ کیا صرف محفوظ قطار میٹا ڈیٹا اور فالو اَپ ریکارڈ ابھی بھیجیں؟", cellularBody: "اس کنکشن میں موبائل ڈیٹا استعمال ہو سکتا ہے۔ ابھی ہم وقت سازی کرنی ہو تو جاری رکھیں۔", unknownBody: "کنکشن کی قسم معلوم نہیں۔ ابھی ہم وقت سازی کرنی ہو تو جاری رکھیں۔", continue: "ابھی ہم وقت کریں", cancel: "ابھی نہیں", saved: "مقامی کام اسی ڈیوائس پر محفوظ رہے گا۔", resume: (completed, total) => `دوبارہ شروع ہونے والی ہم وقت سازی: ${total} میں سے ${completed} کام تیار ہیں۔` },
  ta: { confirmTitle: "சேமித்த பணியை ஒத்திசைக்கவா?", wifiBody: "Wi-Fi உள்ளது. சேமித்த வரிசை மெட்டாடேட்டா மற்றும் பின்தொடர்பு பதிவுகளை மட்டும் இப்போது அனுப்பவா?", cellularBody: "இந்த இணைப்பு மொபைல் தரவைப் பயன்படுத்தலாம். இப்போது ஒத்திசைக்க விரும்பினால் மட்டும் தொடரவும்.", unknownBody: "இணைப்பு வகை தெரியவில்லை. இப்போது ஒத்திசைக்க விரும்பினால் மட்டும் தொடரவும்.", continue: "இப்போது ஒத்திசைக்கவும்", cancel: "இப்போது வேண்டாம்", saved: "உள்ளூர் பணி இந்த சாதனத்தில் பாதுகாப்பாக இருக்கும்.", resume: (completed, total) => `மீண்டும் தொடங்கும் ஒத்திசைவு: ${total} இல் ${completed} பணிகள் தயார்.` },
  te: { confirmTitle: "సేవ్ చేసిన పనిని సింక్ చేయాలా?", wifiBody: "Wi-Fi అందుబాటులో ఉంది. సేవ్ చేసిన క్యూ మెటాడేటా మరియు ఫాలో-అప్ రికార్డులను మాత్రమే ఇప్పుడు పంపాలా?", cellularBody: "ఈ కనెక్షన్ మొబైల్ డేటాను ఉపయోగించవచ్చు. ఇప్పుడు సింక్ చేయాలనుకుంటే మాత్రమే కొనసాగించండి.", unknownBody: "కనెక్షన్ రకం తెలియదు. ఇప్పుడు సింక్ చేయాలనుకుంటే మాత్రమే కొనసాగించండి.", continue: "ఇప్పుడే సింక్ చేయండి", cancel: "ఇప్పుడు వద్దు", saved: "స్థానిక పని ఈ పరికరంలో భద్రంగా ఉంటుంది.", resume: (completed, total) => `మళ్లీ ప్రారంభించగల సింక్: ${total}లో ${completed} పనులు సిద్ధంగా ఉన్నాయి.` },
};

export function getSyncTransferCopy(language: AppLanguage): SyncTransferCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
