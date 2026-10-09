import type { AppLanguage } from "@/lib/language";

type LowDataCopy = {
  label: string;
  enabled: string;
  disabled: string;
  detail: string;
  alertTitle: string;
  alertBody: string;
  saved: string;
  saveError: string;
};

const copyByLanguage: Record<AppLanguage, LowDataCopy> = {
  en: { label: "Low-data mode", enabled: "Wi-Fi-first sync is on", disabled: "Standard sync is on", detail: "Keep local work offline and avoid background refresh on mobile data.", alertTitle: "Low-data mode", alertBody: "Care notes stay on this device until a suitable connection is available. You can sync manually when ready.", saved: "Low-data preference saved", saveError: "Could not save this preference. Your local work remains protected." },
  bn: { label: "কম-ডেটা মোড", enabled: "ওয়াই-ফাই-প্রথম সিঙ্ক চালু", disabled: "সাধারণ সিঙ্ক চালু", detail: "লোকাল কাজ অফলাইনে রাখুন এবং মোবাইল ডেটায় ব্যাকগ্রাউন্ড রিফ্রেশ এড়ান।", alertTitle: "কম-ডেটা মোড", alertBody: "উপযুক্ত সংযোগ না পাওয়া পর্যন্ত যত্নের নোট এই ডিভাইসে থাকবে। প্রস্তুত হলে ম্যানুয়ালি সিঙ্ক করতে পারেন।", saved: "কম-ডেটা পছন্দ সংরক্ষিত হয়েছে", saveError: "পছন্দটি সংরক্ষণ করা যায়নি। আপনার লোকাল কাজ সুরক্ষিত আছে।" },
  hi: { label: "कम-डेटा मोड", enabled: "Wi-Fi-प्राथमिकता सिंक चालू", disabled: "सामान्य सिंक चालू", detail: "लोकल काम ऑफलाइन रखें और मोबाइल डेटा पर बैकग्राउंड रिफ्रेश से बचें।", alertTitle: "कम-डेटा मोड", alertBody: "उपयुक्त कनेक्शन मिलने तक देखभाल के नोट इसी डिवाइस पर रहेंगे। तैयार होने पर मैनुअल सिंक कर सकते हैं।", saved: "कम-डेटा पसंद सहेजी गई", saveError: "पसंद सहेजी नहीं जा सकी। आपका लोकल काम सुरक्षित है।" },
  ur: { label: "کم ڈیٹا موڈ", enabled: "وائی فائی ترجیحی ہم وقت سازی آن ہے", disabled: "معیاری ہم وقت سازی آن ہے", detail: "مقامی کام آف لائن رکھیں اور موبائل ڈیٹا پر پس منظر کی تازہ کاری سے بچیں۔", alertTitle: "کم ڈیٹا موڈ", alertBody: "مناسب کنکشن دستیاب ہونے تک نگہداشت کے نوٹس اسی ڈیوائس پر رہیں گے۔ تیار ہونے پر دستی طور پر ہم وقت سازی کریں۔", saved: "کم ڈیٹا ترجیح محفوظ ہو گئی", saveError: "ترجیح محفوظ نہیں ہو سکی۔ آپ کا مقامی کام محفوظ ہے۔" },
  ta: { label: "குறைந்த தரவு முறை", enabled: "Wi-Fi முன்னுரிமை ஒத்திசைவு இயக்கத்தில் உள்ளது", disabled: "வழக்கமான ஒத்திசைவு இயக்கத்தில் உள்ளது", detail: "உள்ளூர் பணியை ஆஃப்லைனில் வைத்து மொபைல் தரவில் பின்னணி புதுப்பிப்பைத் தவிர்க்கவும்.", alertTitle: "குறைந்த தரவு முறை", alertBody: "ஏற்ற இணைப்பு கிடைக்கும் வரை பராமரிப்பு குறிப்புகள் இந்த சாதனத்தில் இருக்கும். தயாரானதும் கைமுறையாக ஒத்திசைக்கலாம்.", saved: "குறைந்த தரவு விருப்பம் சேமிக்கப்பட்டது", saveError: "விருப்பத்தை சேமிக்க முடியவில்லை. உங்கள் உள்ளூர் பணி பாதுகாப்பாக உள்ளது." },
  te: { label: "తక్కువ డేటా మోడ్", enabled: "Wi-Fi ప్రాధాన్యత సింక్ ఆన్‌లో ఉంది", disabled: "సాధారణ సింక్ ఆన్‌లో ఉంది", detail: "స్థానిక పనిని ఆఫ్‌లైన్‌లో ఉంచి మొబైల్ డేటాపై బ్యాక్‌గ్రౌండ్ రిఫ్రెష్‌ను నివారించండి.", alertTitle: "తక్కువ డేటా మోడ్", alertBody: "సరైన కనెక్షన్ లభించే వరకు సంరక్షణ నోట్లు ఈ పరికరంలో ఉంటాయి. సిద్ధమైనప్పుడు మాన్యువల్‌గా సింక్ చేయవచ్చు.", saved: "తక్కువ డేటా ప్రాధాన్యత సేవ్ చేయబడింది", saveError: "ప్రాధాన్యతను సేవ్ చేయలేకపోయాం. మీ స్థానిక పని భద్రంగా ఉంది." },
};

export function getLowDataCopy(language: AppLanguage): LowDataCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
