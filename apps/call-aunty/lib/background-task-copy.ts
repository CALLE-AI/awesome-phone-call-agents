import type { AppLanguage } from "@/lib/language";

export type BackgroundTaskStatus = "registered" | "alreadyRegistered" | "completed" | "nothingToSync" | "offline" | "failed" | "unavailable";

type BackgroundTaskCopy = {
  registered: string;
  alreadyRegistered: string;
  completed: string;
  nothingToSync: string;
  offline: string;
  failed: string;
  unavailable: string;
};

const copyByLanguage: Record<AppLanguage, BackgroundTaskCopy> = {
  en: {
    registered: "Background sync is registered.",
    alreadyRegistered: "Background sync is already registered.",
    completed: "Background sync completed successfully.",
    nothingToSync: "Background sync checked for updates; nothing is waiting.",
    offline: "Background sync will retry when the device is connected.",
    failed: "Background sync could not finish. Your local work is preserved.",
    unavailable: "Background sync is unavailable; sync will run when the app is open.",
  },
  bn: {
    registered: "ব্যাকগ্রাউন্ড সিঙ্ক নিবন্ধিত হয়েছে।",
    alreadyRegistered: "ব্যাকগ্রাউন্ড সিঙ্ক আগে থেকেই নিবন্ধিত আছে।",
    completed: "ব্যাকগ্রাউন্ড সিঙ্ক সফলভাবে সম্পন্ন হয়েছে।",
    nothingToSync: "ব্যাকগ্রাউন্ড সিঙ্ক পরীক্ষা শেষ; কিছু অপেক্ষায় নেই।",
    offline: "ডিভাইস সংযুক্ত হলে ব্যাকগ্রাউন্ড সিঙ্ক আবার চেষ্টা করবে।",
    failed: "ব্যাকগ্রাউন্ড সিঙ্ক শেষ করা যায়নি। আপনার লোকাল কাজ সুরক্ষিত আছে।",
    unavailable: "ব্যাকগ্রাউন্ড সিঙ্ক পাওয়া যায়নি; অ্যাপ খোলা থাকলে সিঙ্ক হবে।",
  },
  hi: {
    registered: "बैकग्राउंड सिंक पंजीकृत है।",
    alreadyRegistered: "बैकग्राउंड सिंक पहले से पंजीकृत है।",
    completed: "बैकग्राउंड सिंक सफलतापूर्वक पूरा हुआ।",
    nothingToSync: "बैकग्राउंड सिंक ने जाँच पूरी की; कुछ भी लंबित नहीं है।",
    offline: "डिवाइस कनेक्ट होने पर बैकग्राउंड सिंक फिर कोशिश करेगा।",
    failed: "बैकग्राउंड सिंक पूरा नहीं हो सका। आपका लोकल काम सुरक्षित है।",
    unavailable: "बैकग्राउंड सिंक उपलब्ध नहीं है; ऐप खुला होने पर सिंक होगा।",
  },
  ur: {
    registered: "پس منظر کی ہم وقت سازی رجسٹر ہو گئی ہے۔",
    alreadyRegistered: "پس منظر کی ہم وقت سازی پہلے ہی رجسٹر ہے۔",
    completed: "پس منظر کی ہم وقت سازی کامیابی سے مکمل ہو گئی۔",
    nothingToSync: "پس منظر کی ہم وقت سازی نے جانچ مکمل کی؛ کچھ زیر التوا نہیں۔",
    offline: "ڈیوائس کے منسلک ہونے پر پس منظر کی ہم وقت سازی دوبارہ کوشش کرے گی۔",
    failed: "پس منظر کی ہم وقت سازی مکمل نہیں ہو سکی۔ آپ کا مقامی کام محفوظ ہے۔",
    unavailable: "پس منظر کی ہم وقت سازی دستیاب نہیں؛ ایپ کھلی ہونے پر ہم وقت سازی ہوگی۔",
  },
  ta: {
    registered: "பின்னணி ஒத்திசைவு பதிவு செய்யப்பட்டது.",
    alreadyRegistered: "பின்னணி ஒத்திசைவு ஏற்கனவே பதிவு செய்யப்பட்டுள்ளது.",
    completed: "பின்னணி ஒத்திசைவு வெற்றிகரமாக முடிந்தது.",
    nothingToSync: "பின்னணி ஒத்திசைவு சரிபார்ப்பு முடிந்தது; எதுவும் நிலுவையில் இல்லை.",
    offline: "சாதனம் இணைக்கப்பட்டதும் பின்னணி ஒத்திசைவு மீண்டும் முயற்சிக்கும்.",
    failed: "பின்னணி ஒத்திசைவு முடிக்கப்படவில்லை. உங்கள் உள்ளூர் பணி பாதுகாப்பாக உள்ளது.",
    unavailable: "பின்னணி ஒத்திசைவு கிடைக்கவில்லை; பயன்பாடு திறந்திருக்கும் போது ஒத்திசைவு நடக்கும்.",
  },
  te: {
    registered: "బ్యాక్‌గ్రౌండ్ సింక్ నమోదు చేయబడింది.",
    alreadyRegistered: "బ్యాక్‌గ్రౌండ్ సింక్ ఇప్పటికే నమోదు చేయబడింది.",
    completed: "బ్యాక్‌గ్రౌండ్ సింక్ విజయవంతంగా పూర్తయింది.",
    nothingToSync: "బ్యాక్‌గ్రౌండ్ సింక్ తనిఖీ పూర్తయింది; ఏదీ పెండింగ్‌లో లేదు.",
    offline: "పరికరం కనెక్ట్ అయినప్పుడు బ్యాక్‌గ్రౌండ్ సింక్ మళ్లీ ప్రయత్నిస్తుంది.",
    failed: "బ్యాక్‌గ్రౌండ్ సింక్ పూర్తికాలేదు. మీ స్థానిక పని భద్రంగా ఉంది.",
    unavailable: "బ్యాక్‌గ్రౌండ్ సింక్ అందుబాటులో లేదు; యాప్ తెరిచి ఉన్నప్పుడు సింక్ జరుగుతుంది.",
  },
};

export function getBackgroundTaskCopy(language: AppLanguage, status: BackgroundTaskStatus): string {
  return (copyByLanguage[language] ?? copyByLanguage.en)[status];
}

export function getBackgroundTaskCopySet(language: AppLanguage): BackgroundTaskCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
