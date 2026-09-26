import type { AppLanguage } from "@/lib/language";

type TransferControlCopy = { active: string; paused: string; progress: (done: number, total: number) => string; pause: string; resume: string; cancel: string; cancelBody: string };

const copyByLanguage: Record<AppLanguage, TransferControlCopy> = {
  en: { active: "Sync in progress", paused: "Sync paused", progress: (done, total) => `${done} of ${total} items prepared`, pause: "Pause", resume: "Resume", cancel: "Cancel", cancelBody: "Local work stays saved. You can resume this transfer later." },
  bn: { active: "সিঙ্ক চলছে", paused: "সিঙ্ক থামানো হয়েছে", progress: (done, total) => `${total}টির মধ্যে ${done}টি কাজ প্রস্তুত`, pause: "থামান", resume: "চালু করুন", cancel: "বাতিল", cancelBody: "লোকাল কাজ সংরক্ষিত থাকবে। পরে এই সিঙ্ক আবার চালু করতে পারবেন." },
  hi: { active: "सिंक चल रहा है", paused: "सिंक रुका हुआ है", progress: (done, total) => `${total} में से ${done} काम तैयार`, pause: "रोकें", resume: "जारी रखें", cancel: "रद्द करें", cancelBody: "लोकल काम सुरक्षित रहेगा। आप बाद में इस सिंक को जारी रख सकते हैं।" },
  ur: { active: "ہم وقت سازی جاری ہے", paused: "ہم وقت سازی رکی ہوئی ہے", progress: (done, total) => `${total} میں سے ${done} کام تیار`, pause: "روکیں", resume: "جاری رکھیں", cancel: "منسوخ", cancelBody: "مقامی کام محفوظ رہے گا۔ آپ بعد میں یہ ہم وقت سازی جاری کر سکتے ہیں۔" },
  ta: { active: "ஒத்திசைவு நடைபெறுகிறது", paused: "ஒத்திசைவு நிறுத்தப்பட்டுள்ளது", progress: (done, total) => `${total} இல் ${done} பணிகள் தயார்`, pause: "இடைநிறுத்து", resume: "தொடரவும்", cancel: "ரத்து", cancelBody: "உள்ளூர் பணி பாதுகாப்பாக இருக்கும். இந்த ஒத்திசைவை பின்னர் தொடரலாம்." },
  te: { active: "సింక్ జరుగుతోంది", paused: "సింక్ ఆపివేయబడింది", progress: (done, total) => `${total}లో ${done} పనులు సిద్ధం`, pause: "ఆపండి", resume: "కొనసాగించండి", cancel: "రద్దు", cancelBody: "స్థానిక పని భద్రంగా ఉంటుంది. ఈ సింక్‌ను తర్వాత కొనసాగించవచ్చు." },
};

export function getTransferControlCopy(language: AppLanguage): TransferControlCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
