/**
 * Synthetic CHW household fixtures for the mobile demo.
 * Names, villages, and phone masks are fictional — never real patient data.
 */
import type { AppLanguage } from "@/lib/language";
import type { QueueTone } from "@/lib/queue-types";

export type L10n = { en: string; bn?: string; hi?: string; ur?: string };

export type MockChannel = "call-e" | "visit" | "sms" | "missed";
export type MockCallOutcome =
  | "completed"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "callback"
  | "safety"
  | "declined"
  | "consent_hold";

export type MockTimelineEvent = {
  id: string;
  at: L10n;
  channel: MockChannel;
  outcome: MockCallOutcome;
  summary: L10n;
};

export type MockHousehold = {
  id: string;
  beneficiaryId: string;
  names: Required<Pick<L10n, "en" | "bn" | "hi" | "ur">>;
  weeks: number;
  village: L10n;
  preferredLanguage: AppLanguage;
  tone: QueueTone;
  consent: "granted" | "missing" | "expired";
  meta: L10n;
  nextAction: L10n;
  lastCheckIn: L10n;
  careContact: L10n;
  openTask: L10n;
  callbackWindow: L10n;
  ironStatus: L10n;
  notes: L10n;
  calleScenario: string;
  maskedPhone: string;
  routeOrder: number;
  timeline: MockTimelineEvent[];
};

export function localize(text: L10n, language: AppLanguage): string {
  if (language === "bn" || language === "hi" || language === "ur") {
    return text[language] ?? text.en;
  }
  return text.en;
}

export function householdName(household: MockHousehold, language: AppLanguage): string {
  if (language === "bn" || language === "hi" || language === "ur") {
    return household.names[language] ?? household.names.en;
  }
  return household.names.en;
}

const TONE_URGENCY: Record<QueueTone, L10n> = {
  urgent: { en: "Urgent", bn: "জরুরি", hi: "अत्यावश्यक", ur: "فوری" },
  attention: { en: "Needs attention", bn: "মনোযোগ দরকার", hi: "ध्यान दें", ur: "توجہ درکار" },
  routine: { en: "Routine", bn: "নিয়মিত", hi: "नियमित", ur: "معمول" },
};

export const MOCK_HOUSEHOLDS: readonly MockHousehold[] = [
  {
    id: "rina",
    beneficiaryId: "demo-ben-001",
    names: { en: "Rina Begum", bn: "রিনা বেগম", hi: "रीना बेगम", ur: "رینہ بیگم" },
    weeks: 32,
    village: { en: "Korail", bn: "কড়াইল", hi: "कोरैल", ur: "کورائل" },
    preferredLanguage: "bn",
    tone: "urgent",
    consent: "granted",
    meta: { en: "32 weeks · check-in missed", bn: "৩২ সপ্তাহ · চেক-ইন বাকি", hi: "३२ सप्ताह · चेक-इन छूटा", ur: "۳۲ ہفتے · چیک اِن رہ گیا" },
    nextAction: { en: "Call today", bn: "আজ কল করুন", hi: "आज कॉल करें", ur: "آج کال کریں" },
    lastCheckIn: { en: "4 days ago · incomplete", bn: "৪ দিন আগে · অসম্পূর্ণ", hi: "४ दिन पहले · अधूरा", ur: "۴ دن پہلے · نامکمل" },
    careContact: { en: "ANC visit overdue", bn: "এএনসি ভিজিট বাকি", hi: "एएनसी विज़िट बकाया", ur: "اے این سی وزٹ باقی" },
    openTask: { en: "Missed check-in follow-up", bn: "মিসড চেক-ইন ফলো-আপ", hi: "छूटे चेक-इन का फॉलो-अप", ur: "چھوٹے ہوئے چیک اِن کا فالو اَپ" },
    callbackWindow: { en: "Safe window 6–8 PM", bn: "নিরাপদ সময় সন্ধ্যা ৬–৮টা", hi: "सुरक्षित समय शाम ६–८", ur: "محفوظ وقت شام ۶–۸" },
    ironStatus: { en: "Iron tablets: 4 days missed", bn: "আয়রন ট্যাবলেট: ৪ দিন বাদ", hi: "आयरन गोली: ४ दिन छूटी", ur: "آئرن گولیاں: ۴ دن رہ گئیں" },
    notes: { en: "Shared phone. Use a neutral greeting.", bn: "শেয়ার করা ফোন। নিরপেক্ষ শুভেচ্ছা ব্যবহার করুন।", hi: "साझा फ़ोन। सामान्य अभिवादन करें।", ur: "مشترکہ فون۔ غیر جانبدار سلام استعمال کریں۔" },
    calleScenario: "no_answer",
    maskedPhone: "+880•••555•0101",
    routeOrder: 1,
    timeline: [
      { id: "rina-t1", at: { en: "Yesterday · 7:04 PM", bn: "গতকাল · সন্ধ্যা ৭:০৪" }, channel: "call-e", outcome: "no_answer", summary: { en: "Mock CALL-E: no answer after two rings.", bn: "মক CALL-E: দুবার রিংয়ের পর উত্তর নেই।" } },
      { id: "rina-t2", at: { en: "3 days ago · visit", bn: "৩ দিন আগে · ভিজিট" }, channel: "visit", outcome: "callback", summary: { en: "Family asked to call after maghrib.", bn: "পরিবার মাগরিবের পর কল করতে বলেছে।" } },
    ],
  },
  {
    id: "shahana",
    beneficiaryId: "demo-ben-002",
    names: { en: "Shahana Akter", bn: "শাহানা আক্তার", hi: "शाहाना अख्तर", ur: "شاہانہ اختر" },
    weeks: 24,
    village: { en: "Mirpur 11", bn: "মিরপুর ১১", hi: "मीरपुर ११", ur: "میرپور ۱۱" },
    preferredLanguage: "bn",
    tone: "attention",
    consent: "granted",
    meta: { en: "24 weeks · referral pending", bn: "২৪ সপ্তাহ · রেফারেল বাকি", hi: "२४ सप्ताह · रेफरल लंबित", ur: "۲۴ ہفتے · ریفرل باقی" },
    nextAction: { en: "Confirm referral", bn: "রেফারেল নিশ্চিত করুন", hi: "रेफरल पुष्टि करें", ur: "ریفرل کی تصدیق کریں" },
    lastCheckIn: { en: "Yesterday · routine", bn: "গতকাল · নিয়মিত", hi: "कल · नियमित", ur: "کل · معمول" },
    careContact: { en: "Clinic contact not confirmed", bn: "ক্লিনিক যোগাযোগ নিশ্চিত নয়", hi: "क्लिनिक संपर्क पुष्ट नहीं", ur: "کلینک رابطہ تصدیق شدہ نہیں" },
    openTask: { en: "Referral acknowledgement", bn: "রেফারেল স্বীকৃতি", hi: "रेफरल पावती", ur: "ریفرل کی تصدیق" },
    callbackWindow: { en: "Safe window 5–7 PM", bn: "নিরাপদ সময় বিকেল ৫–৭টা", hi: "सुरक्षित समय शाम ५–७", ur: "محفوظ وقت شام ۵–۷" },
    ironStatus: { en: "Iron tablets: on track", bn: "আয়রন ট্যাবলেট: ঠিক আছে", hi: "आयरन गोली: नियमित", ur: "آئرن گولیاں: ٹھیک چل رہی ہیں" },
    notes: { en: "Prefers Bangla. Husband often answers first.", bn: "বাংলা পছন্দ। প্রথমে স্বামী ধরেন।", hi: "बांग्ला पसंद। पति अक्सर पहले उठाते हैं।", ur: "بنگلہ پسند ہے۔ شوہر اکثر پہلے اٹھاتے ہیں۔" },
    calleScenario: "needs_follow_up",
    maskedPhone: "+880•••555•0102",
    routeOrder: 4,
    timeline: [
      { id: "shahana-t1", at: { en: "This morning · 8:20 AM", bn: "আজ সকাল · ৮:২০" }, channel: "sms", outcome: "callback", summary: { en: "Mock SMS: clinic asked the family to confirm.", bn: "মক এসএমএস: ক্লিনিক পরিবারকে নিশ্চিত করতে বলেছে।" } },
      { id: "shahana-t2", at: { en: "Yesterday · check-in", bn: "গতকাল · চেক-ইন" }, channel: "visit", outcome: "completed", summary: { en: "Check-in completed; referral still open.", bn: "চেক-ইন সম্পন্ন; রেফারেল এখনও খোলা।" } },
    ],
  },
  {
    id: "mousumi",
    beneficiaryId: "demo-ben-003",
    names: { en: "Mousumi Khatun", bn: "মৌসুমি খাতুন", hi: "मौसुमी खातून", ur: "موسمی خاتون" },
    weeks: 18,
    village: { en: "Mohammadpur", bn: "মোহাম্মদপুর", hi: "मोहम्मदपुर", ur: "محمد پور" },
    preferredLanguage: "bn",
    tone: "routine",
    consent: "granted",
    meta: { en: "18 weeks · due today", bn: "১৮ সপ্তাহ · আজকের কাজ", hi: "१८ सप्ताह · आज देय", ur: "۱۸ ہفتے · آج کا کام" },
    nextAction: { en: "Visit due today", bn: "আজকের ভিজিট", hi: "आज विज़िट देय", ur: "آج وزٹ واجب" },
    lastCheckIn: { en: "6 days ago · routine", bn: "৬ দিন আগে · নিয়মিত", hi: "६ दिन पहले · नियमित", ur: "۶ دن پہلے · معمول" },
    careContact: { en: "ANC visit due today", bn: "আজ এএনসি ভিজিট", hi: "आज एएनसी विज़िट", ur: "آج اے این سی وزٹ" },
    openTask: { en: "Routine home visit", bn: "নিয়মিত হোম ভিজিট", hi: "नियमित होम विज़िट", ur: "معمولی گھر وزٹ" },
    callbackWindow: { en: "Late morning", bn: "সকালের শেষভাগ", hi: "सुबह देर से", ur: "صبح کے آخر میں" },
    ironStatus: { en: "Iron tablets: started this week", bn: "আয়রন ট্যাবলেট: এই সপ্তাহে শুরু", hi: "आयरन गोली: इस सप्ताह शुरू", ur: "آئرن گولیاں: اس ہفتے شروع" },
    notes: { en: "First pregnancy. Mother-in-law usually present.", bn: "প্রথম গর্ভাবস্থা। শাশুড়ি সাধারণত থাকেন।", hi: "पहली गर्भावस्था। सास आमतौर पर साथ रहती हैं।", ur: "پہلی حمل۔ ساس عموماً موجود رہتی ہیں۔" },
    calleScenario: "completed",
    maskedPhone: "+880•••555•0103",
    routeOrder: 7,
    timeline: [
      { id: "mousumi-t1", at: { en: "Last week · mock call", bn: "গত সপ্তাহ · মক কল" }, channel: "call-e", outcome: "completed", summary: { en: "Mock CALL-E: appointment reminder confirmed.", bn: "মক CALL-E: অ্যাপয়েন্টমেন্ট রিমাইন্ডার নিশ্চিত।" } },
    ],
  },
  {
    id: "farhana",
    beneficiaryId: "demo-ben-011",
    names: { en: "Farhana Islam", bn: "ফারহানা ইসলাম", hi: "फरहाना इस्लाम", ur: "فرحانہ اسلام" },
    weeks: 36,
    village: { en: "Badda", bn: "বাড্ডা", hi: "बड्डा", ur: "بڈڈا" },
    preferredLanguage: "bn",
    tone: "urgent",
    consent: "granted",
    meta: { en: "36 weeks · swelling + headache", bn: "৩৬ সপ্তাহ · ফোলা ও মাথাব্যথা", hi: "३६ सप्ताह · सूजन और सिरदर्द", ur: "۳۶ ہفتے · سوجن اور سر درد" },
    nextAction: { en: "Same-day in-person visit", bn: "আজই সশরীরে দেখা", hi: "आज व्यक्तिगत विज़िट", ur: "آج ذاتی وزٹ" },
    lastCheckIn: { en: "Today · danger signs reported", bn: "আজ · বিপদচিহ্ন জানানো হয়েছে", hi: "आज · खतरे के संकेत", ur: "آج · خطرے کی علامات" },
    careContact: { en: "Same-day clinician review", bn: "আজই চিকিৎসকের পর্যালোচনা", hi: "आज चिकित्सक समीक्षा", ur: "آج معالج کا جائزہ" },
    openTask: { en: "Escalation to clinic", bn: "ক্লিনিকে এস্কালেশন", hi: "क्लिनिक तक एस्केलेशन", ur: "کلینک تک ایکسیلریشن" },
    callbackWindow: { en: "Now — do not delay", bn: "এখনই — দেরি নয়", hi: "अभी — देर न करें", ur: "ابھی — تاخیر نہ کریں" },
    ironStatus: { en: "BP check needed before iron advice", bn: "আয়রনের আগে বিপি মাপতে হবে", hi: "आयरन से पहले बीपी जाँच", ur: "آئرن سے پہلے بی پی چیک" },
    notes: { en: "Mock safety path. Keep human follow-up primary.", bn: "মক সেফটি পথ। মানব ফলো-আপই মুখ্য রাখুন।", hi: "मॉक सुरक्षा पथ। मानवीय फॉलो-अप प्राथमिक रखें।", ur: "ماک سیفٹی راستہ۔ انسانی فالو اَپ بنیادی رکھیں۔" },
    calleScenario: "safety_escalation",
    maskedPhone: "+880•••555•0111",
    routeOrder: 2,
    timeline: [
      { id: "farhana-t1", at: { en: "Today · 7:40 AM", bn: "আজ · সকাল ৭:৪০" }, channel: "call-e", outcome: "safety", summary: { en: "Mock CALL-E: probing stopped; safety script used.", bn: "মক CALL-E: প্রশ্ন বন্ধ; সেফটি স্ক্রিপ্ট ব্যবহার।" } },
    ],
  },
  {
    id: "yasmin",
    beneficiaryId: "demo-ben-012",
    names: { en: "Yasmin Sultana", bn: "ইয়াসমিন সুলতানা", hi: "यास्मीन सुल्ताना", ur: "یاسمین سلطانہ" },
    weeks: 28,
    village: { en: "Gulshan 1", bn: "গুলশান ১", hi: "गुलशन १", ur: "گلشن ۱" },
    preferredLanguage: "bn",
    tone: "attention",
    consent: "granted",
    meta: { en: "28 weeks · iron not taken", bn: "২৮ সপ্তাহ · আয়রন খাওয়া হয়নি", hi: "२८ सप्ताह · आयरन नहीं लिया", ur: "۲۸ ہفتے · آئرن نہیں لیا" },
    nextAction: { en: "Counsel + reminder SMS", bn: "পরামর্শ + রিমাইন্ডার এসএমএস", hi: "सलाह + रिमाइंडर एसएमएस", ur: "مشورہ + یاددہانی ایس ایم ایس" },
    lastCheckIn: { en: "2 days ago · mild fatigue", bn: "২ দিন আগে · হালকা ক্লান্তি", hi: "२ दिन पहले · हल्की थकान", ur: "۲ دن پہلے · ہلکی تھکن" },
    careContact: { en: "Nutrition counseling due", bn: "পুষ্টি পরামর্শ বাকি", hi: "पोषण परामर्श देय", ur: "غذائیت مشورہ باقی" },
    openTask: { en: "Iron adherence follow-up", bn: "আয়রন নিয়মিত গ্রহণ", hi: "आयरन नियमितता", ur: "آئرن کا باقاعدہ استعمال" },
    callbackWindow: { en: "Afternoon nap hours — avoid 1–3 PM", bn: "বিকেলের ঘুমের সময় এড়িয়ে চলুন ১–৩টা", hi: "दोपहर १–३ बजे से बचें", ur: "دوپہر ۱–۳ بجے سے گریز" },
    ironStatus: { en: "Iron tablets: 6 of 14 missed", bn: "আয়রন ট্যাবলেট: ১৪টার মধ্যে ৬টি বাদ", hi: "आयरन गोली: १४ में से ६ छूटी", ur: "آئرن گولیاں: ۱۴ میں سے ۶ رہ گئیں" },
    notes: { en: "Nausea after tablets. Offer evening dose.", bn: "ট্যাবলেটের পর বমিবমি ভাব। সন্ধ্যার ডোজ দিন।", hi: "गोली के बाद मतली। शाम की खुराक दें।", ur: "گولی کے بعد متلی۔ شام کی خوراک دیں۔" },
    calleScenario: "busy",
    maskedPhone: "+880•••555•0112",
    routeOrder: 5,
    timeline: [
      { id: "yasmin-t1", at: { en: "Yesterday · 1:15 PM", bn: "গতকাল · দুপুর ১:১৫" }, channel: "call-e", outcome: "busy", summary: { en: "Mock CALL-E: line busy during nap window.", bn: "মক CALL-E: ঘুমের সময় লাইন ব্যস্ত।" } },
    ],
  },
  {
    id: "nasrin",
    beneficiaryId: "demo-ben-013",
    names: { en: "Nasrin Jahan", bn: "নাসরিন জাহান", hi: "नसरीन जहां", ur: "نسرین جہاں" },
    weeks: 12,
    village: { en: "Uttara 7", bn: "উত্তরা ৭", hi: "उत्तर ७", ur: "اتارہ ۷" },
    preferredLanguage: "en",
    tone: "routine",
    consent: "granted",
    meta: { en: "12 weeks · first ANC booked", bn: "১২ সপ্তাহ · প্রথম এএনসি বুক", hi: "१२ सप्ताह · पहली एएनसी बुक", ur: "۱۲ ہفتے · پہلی اے این سی بک" },
    nextAction: { en: "Confirm clinic slot", bn: "ক্লিনিক স্লট নিশ্চিত করুন", hi: "क्लिनिक स्लोट पुष्टि करें", ur: "کلینک سلاٹ کی تصدیق کریں" },
    lastCheckIn: { en: "Today · new registration", bn: "আজ · নতুন নিবন্ধন", hi: "आज · नया पंजीकरण", ur: "آج · نیا اندراج" },
    careContact: { en: "First ANC in 3 days", bn: "৩ দিনে প্রথম এএনসি", hi: "३ दिन में पहली एएनसी", ur: "۳ دن میں پہلی اے این سی" },
    openTask: { en: "Welcome visit + consent card", bn: "স্বাগত ভিজিট + সম্মতি কার্ড", hi: "स्वागत विज़िट + सहमति कार्ड", ur: "خوش آمدیدی وزٹ + رضامندی کارڈ" },
    callbackWindow: { en: "Lunch break 1–2 PM", bn: "দুপুর ১–২টা বিরতি", hi: "दोपहर १–२ बजे", ur: "دوپہر ۱–۲ بجے" },
    ironStatus: { en: "Iron tablets: not started yet", bn: "আয়রন ট্যাবলেট: এখনও শুরু হয়নি", hi: "आयरन गोली: अभी शुरू नहीं", ur: "آئرن گولیاں: ابھی شروع نہیں" },
    notes: { en: "Comfortable in English. Works until 4 PM.", bn: "ইংরেজিতে স্বস্তি। বিকেল ৪টা পর্যন্ত কাজ।", hi: "अंग्रेज़ी में सहज। शाम ४ बजे तक काम।", ur: "انگریزی میں آرام دہ۔ شام ۴ بجے تک کام。" },
    calleScenario: "completed",
    maskedPhone: "+880•••555•0113",
    routeOrder: 8,
    timeline: [
      { id: "nasrin-t1", at: { en: "Today · 9:05 AM", bn: "আজ · সকাল ৯:০৫" }, channel: "sms", outcome: "completed", summary: { en: "Mock SMS: first ANC slot held.", bn: "মক এসএমএস: প্রথম এএনসি স্লট রাখা হয়েছে।" } },
    ],
  },
  {
    id: "fatema",
    beneficiaryId: "demo-ben-004",
    names: { en: "Fatema Khatun", bn: "ফাতেমা খাতুন", hi: "फातेमा खातून", ur: "فاطمہ خاتون" },
    weeks: 30,
    village: { en: "Old Dhaka", bn: "পুরান ঢাকা", hi: "पुराना ढाका", ur: "پرانا ڈھاکہ" },
    preferredLanguage: "bn",
    tone: "attention",
    consent: "granted",
    meta: { en: "30 weeks · mock call no-answer", bn: "৩০ সপ্তাহ · মক কলে উত্তর নেই", hi: "३० सप्ताह · मॉक कॉल का जवाब नहीं", ur: "۳۰ ہفتے · ماک کال کا جواب نہیں" },
    nextAction: { en: "Call after maghrib", bn: "মাগরিবের পর কল", hi: "मगरिब के बाद कॉल", ur: "مغرب کے بعد کال" },
    lastCheckIn: { en: "5 days ago · routine", bn: "৫ দিন আগে · নিয়মিত", hi: "५ दिन पहले · नियमित", ur: "۵ دن پہلے · معمول" },
    careContact: { en: "Callback window tonight", bn: "আজ রাতে কলব্যাক", hi: "आज रात कॉलबैक", ur: "آج رات کال بیک" },
    openTask: { en: "Retry mock CALL-E", bn: "মক CALL-E আবার চেষ্টা", hi: "मॉक CALL-E फिर कोशिश", ur: "ماک CALL-E دوبارہ کوشش" },
    callbackWindow: { en: "After maghrib · 7:30 PM", bn: "মাগরিবের পর · সন্ধ্যা ৭:৩০", hi: "मगरिब के बाद · ७:३० PM", ur: "مغرب کے بعد · شام ۷:۳۰" },
    ironStatus: { en: "Iron tablets: on track", bn: "আয়রন ট্যাবলেট: ঠিক আছে", hi: "आयरन गोली: नियमित", ur: "آئرن گولیاں: ٹھیک" },
    notes: { en: "Phone often with brother during the day.", bn: "দিনে ফোন প্রায়ই ভাইয়ের কাছে।", hi: "दिन में फ़ोन अक्सर भाई के पास।", ur: "دن میں فون اکثر بھائی کے پاس ہوتا ہے۔" },
    calleScenario: "voicemail",
    maskedPhone: "+880•••555•0104",
    routeOrder: 6,
    timeline: [
      { id: "fatema-t1", at: { en: "Today · 11:48 AM", bn: "আজ · সকাল ১১:৪৮" }, channel: "call-e", outcome: "voicemail", summary: { en: "Mock CALL-E: voicemail, no callback yet.", bn: "মক CALL-E: ভয়েসমেইল, এখনও কলব্যাক নেই।" } },
      { id: "fatema-t2", at: { en: "This morning · missed", bn: "আজ সকাল · মিসড" }, channel: "missed", outcome: "no_answer", summary: { en: "CHW outbound missed while in market.", bn: "বাজারে থাকায় সিএইচডব্লিউ কল মিস।" } },
    ],
  },
  {
    id: "lila",
    beneficiaryId: "demo-ben-005",
    names: { en: "Lila Rahman", bn: "লীলা রহমান", hi: "लीला रहमान", ur: "لیلہ رحمان" },
    weeks: 22,
    village: { en: "Savar", bn: "সাভার", hi: "सावार", ur: "ساور" },
    preferredLanguage: "bn",
    tone: "routine",
    consent: "granted",
    meta: { en: "22 weeks · mock call completed", bn: "২২ সপ্তাহ · মক কল সম্পন্ন", hi: "२२ सप्ताह · मॉक कॉल पूरा", ur: "۲۲ ہفتے · ماک کال مکمل" },
    nextAction: { en: "Review notes only", bn: "শুধু নোট দেখুন", hi: "केवल नोट देखें", ur: "صرف نوٹس دیکھیں" },
    lastCheckIn: { en: "Yesterday · completed", bn: "গতকাল · সম্পন্ন", hi: "कल · पूरा", ur: "کل · مکمل" },
    careContact: { en: "Next ANC in 18 days", bn: "১৮ দিনে পরবর্তী এএনসি", hi: "१८ दिन में अगली एएनसी", ur: "۱۸ دن میں اگلی اے این سی" },
    openTask: { en: "No open task", bn: "কোনো খোলা কাজ নেই", hi: "कोई खुला काम नहीं", ur: "کوئی کھلا کام نہیں" },
    callbackWindow: { en: "Evenings after 7 PM", bn: "সন্ধ্যা ৭টার পর", hi: "शाम ७ बजे के बाद", ur: "شام ۷ بجے کے بعد" },
    ironStatus: { en: "Iron tablets: on track", bn: "আয়রন ট্যাবলেট: ঠিক আছে", hi: "आयरन गोली: नियमित", ur: "آئرن گولیاں: ٹھیک" },
    notes: { en: "Happy-path demo record. Keep in queue for contrast.", bn: "হ্যাপি-পাথ ডেমো রেকর্ড। তুলনার জন্য কিউতে রাখুন।", hi: "हैपी-पाथ डेमो रिकॉर्ड।", ur: "ہیپی پاتھ ڈیمو ریکارڈ۔" },
    calleScenario: "completed",
    maskedPhone: "+880•••555•0105",
    routeOrder: 10,
    timeline: [
      { id: "lila-t1", at: { en: "Yesterday · 6:40 PM", bn: "গতকাল · সন্ধ্যা ৬:৪০" }, channel: "call-e", outcome: "completed", summary: { en: "Mock CALL-E: family update completed.", bn: "মক CALL-E: পরিবারের আপডেট সম্পন্ন।" } },
    ],
  },
  {
    id: "aleya",
    beneficiaryId: "demo-ben-006",
    names: { en: "Aleya Khatun", bn: "আলেয়া খাতুন", hi: "आलिया खातून", ur: "آلیہ خاتون" },
    weeks: 34,
    village: { en: "Keraniganj", bn: "কেরানীগঞ্জ", hi: "केरानीगंज", ur: "کیرانی گنج" },
    preferredLanguage: "bn",
    tone: "urgent",
    consent: "granted",
    meta: { en: "34 weeks · safety escalation", bn: "৩৪ সপ্তাহ · সেফটি এস্কালেশন", hi: "३४ सप्ताह · सुरक्षा एस्केलेशन", ur: "۳۴ ہفتے · سیفٹی ایکسیلریشن" },
    nextAction: { en: "Human follow-up now", bn: "এখনই মানব ফলো-আপ", hi: "अभी मानवीय फॉलो-अप", ur: "ابھی انسانی فالو اَپ" },
    lastCheckIn: { en: "Today · distress branch", bn: "আজ · ডিস্ট্রেস শাখা", hi: "आज · डिस्ट्रेस शाखा", ur: "آج · ڈسٹریس برانچ" },
    careContact: { en: "Do not re-probe by phone", bn: "ফোনে আর প্রশ্ন নয়", hi: "फ़ोन से फिर न पूछें", ur: "فون پر دوبارہ سوال نہ کریں" },
    openTask: { en: "In-person safety check", bn: "সশরীরে সেফটি চেক", hi: "व्यक्तिगत सुरक्षा जाँच", ur: "ذاتی سیفٹی چیک" },
    callbackWindow: { en: "CHW visit — not a second auto-dial", bn: "সিএইচডব্লিউ ভিজিট — দ্বিতীয় অটো-ডায়াল নয়", hi: "सीएचडब्ल्यू विज़िट — दूसरी ऑटो-डायल नहीं", ur: "سی ایچ ڈبلیو وزٹ — دوسری آٹو ڈائل نہیں" },
    ironStatus: { en: "Hold optional questions", bn: "ঐচ্ছিক প্রশ্ন স্থগিত", hi: "वैकल्पिक प्रश्न रोकें", ur: "اختیاری سوالات روکیں" },
    notes: { en: "Paired with the distress replay fixture.", bn: "ডিস্ট্রেস রিপ্লে ফিক্সচারের সঙ্গে যুক্ত।", hi: "डिस्ट्रेस रीप्ले फिक्स्चर से जुड़ा।", ur: "ڈسٹریس ریپلے فکسچر سے منسلک۔" },
    calleScenario: "safety_escalation",
    maskedPhone: "+880•••555•0106",
    routeOrder: 3,
    timeline: [
      { id: "aleya-t1", at: { en: "Today · 8:02 AM", bn: "আজ · সকাল ৮:০২" }, channel: "call-e", outcome: "safety", summary: { en: "Mock CALL-E: safety script; probing stopped.", bn: "মক CALL-E: সেফটি স্ক্রিপ্ট; প্রশ্ন বন্ধ।" } },
    ],
  },
  {
    id: "rumana",
    beneficiaryId: "demo-ben-008",
    names: { en: "Rumana Akter", bn: "রুমানা আক্তার", hi: "रुमाना अख्तर", ur: "رومانہ اختر" },
    weeks: 26,
    village: { en: "Tongi", bn: "টঙ্গী", hi: "टोंगी", ur: "ٹونگی" },
    preferredLanguage: "bn",
    tone: "attention",
    consent: "granted",
    meta: { en: "26 weeks · voicemail waiting", bn: "২৬ সপ্তাহ · ভয়েসমেইল অপেক্ষমাণ", hi: "२६ सप्ताह · वॉइसमेल इंतज़ार", ur: "۲۶ ہفتے · وائس میل انتظار" },
    nextAction: { en: "Callback at 7 PM", bn: "সন্ধ্যা ৭টায় কলব্যাক", hi: "शाम ७ बजे कॉलबैक", ur: "شام ۷ بجے کال بیک" },
    lastCheckIn: { en: "3 days ago · routine", bn: "৩ দিন আগে · নিয়মিত", hi: "३ दिन पहले · नियमित", ur: "۳ دن پہلے · معمول" },
    careContact: { en: "Human handoff requested", bn: "মানব হ্যান্ডঅফ চাওয়া হয়েছে", hi: "मानवीय हैंडऑफ अनुरोध", ur: "انسانی ہینڈ آف کی درخواست" },
    openTask: { en: "Evening callback", bn: "সন্ধ্যার কলব্যাক", hi: "शाम का कॉलबैक", ur: "شام کا کال بیک" },
    callbackWindow: { en: "7:00–7:20 PM only", bn: "শুধু সন্ধ্যা ৭:০০–৭:২০", hi: "केवल शाम ७:۰۰–७:२०", ur: "صرف شام ۷:۰۰–۷:۲۰" },
    ironStatus: { en: "Iron tablets: on track", bn: "আয়রন ট্যাবলেট: ঠিক আছে", hi: "आयरन गोली: नियमित", ur: "آئرن گولیاں: ٹھیک" },
    notes: { en: "Asked for a CHW, not another automated call.", bn: "আরেকটি অটো কল নয়, সিএইচডব্লিউ চান।", hi: "और ऑटो कॉल नहीं, सीएचडब्ल्यू चाहिए।", ur: "اور آٹو کال نہیں، سی ایچ ڈبلیو چاہیے۔" },
    calleScenario: "needs_follow_up",
    maskedPhone: "+880•••555•0108",
    routeOrder: 9,
    timeline: [
      { id: "rumana-t1", at: { en: "Yesterday · 7:11 PM", bn: "গতকাল · সন্ধ্যা ৭:১১" }, channel: "call-e", outcome: "voicemail", summary: { en: "Mock CALL-E: voicemail left; family asked for CHW.", bn: "মক CALL-E: ভয়েসমেইল; পরিবার সিএইচডব্লিউ চেয়েছে।" } },
    ],
  },
  {
    id: "jannat",
    beneficiaryId: "demo-ben-007",
    names: { en: "Jannat Ara", bn: "জান্নাত আরা", hi: "जन्नत आरा", ur: "جنت آرا" },
    weeks: 8,
    village: { en: "Gazipur", bn: "গাজীপুর", hi: "गाजीपुर", ur: "غازی پور" },
    preferredLanguage: "hi",
    tone: "routine",
    consent: "granted",
    meta: { en: "8 weeks · new registration", bn: "৮ সপ্তাহ · নতুন নিবন্ধন", hi: "८ सप्ताह · नया पंजीकरण", ur: "۸ ہفتے · نیا اندراج" },
    nextAction: { en: "Welcome visit", bn: "স্বাগত ভিজিট", hi: "स्वागत विज़िट", ur: "خوش آمدیدی وزٹ" },
    lastCheckIn: { en: "Not yet started", bn: "এখনও শুরু হয়নি", hi: "अभी शुरू नहीं", ur: "ابھی شروع نہیں" },
    careContact: { en: "First contact this week", bn: "এই সপ্তাহে প্রথম যোগাযোগ", hi: "इस सप्ताह पहला संपर्क", ur: "اس ہفتے پہلا رابطہ" },
    openTask: { en: "Register + explain check-in", bn: "নিবন্ধন + চেক-ইন ব্যাখ্যা", hi: "पंजीकरण + चेक-इन समझाएँ", ur: "اندراج + چیک اِن کی وضاحت" },
    callbackWindow: { en: "Morning before 11 AM", bn: "সকাল ১১টার আগে", hi: "सुबह ११ बजे से पहले", ur: "صبح ۱۱ بجے سے پہلے" },
    ironStatus: { en: "Folic acid counseling pending", bn: "ফলিক অ্যাসিড পরামর্শ বাকি", hi: "फोलिक एसिड परामर्श बाकी", ur: "فولک ایسڈ مشورہ باقی" },
    notes: { en: "Prefers Hindi. First time using Call Aunty.", bn: "হিন্দি পছন্দ। কল আন্টি প্রথমবার।", hi: "हिन्दी पसंद। कॉल आंटी पहली बार।", ur: "ہندی پسند ہے۔ کال آنٹی پہلی بار۔" },
    calleScenario: "completed",
    maskedPhone: "+880•••555•0107",
    routeOrder: 11,
    timeline: [
      { id: "jannat-t1", at: { en: "Today · registered", bn: "আজ · নিবন্ধিত" }, channel: "visit", outcome: "completed", summary: { en: "Mock intake: household added to today’s queue.", bn: "মক ইনটেক: আজকের কিউতে যোগ।" } },
    ],
  },
  {
    id: "parveen",
    beneficiaryId: "demo-ben-009",
    names: { en: "Parveen Banu", bn: "পারভীন বানু", hi: "परवीन बानो", ur: "پروین بانو" },
    weeks: 20,
    village: { en: "Narayanganj", bn: "নারায়ণগঞ্জ", hi: "नारायणगंज", ur: "نارائن گنج" },
    preferredLanguage: "ur",
    tone: "attention",
    consent: "missing",
    meta: { en: "20 weeks · consent missing", bn: "২০ সপ্তাহ · সম্মতি নেই", hi: "२० सप्ताह · सहमति नहीं", ur: "۲۰ ہفتے · رضامندی نہیں" },
    nextAction: { en: "Do not auto-dial", bn: "অটো-ডায়াল নয়", hi: "ऑटो-डायल न करें", ur: "آٹو ڈائل نہ کریں" },
    lastCheckIn: { en: "Unknown — consent card unsigned", bn: "অজানা — সম্মতি কার্ড স্বাক্ষরিত নয়", hi: "अज्ञात — सहमति कार्ड पर हस्ताक्षर नहीं", ur: "نامعلوم — رضامندی کارڈ دستخط شدہ نہیں" },
    careContact: { en: "In-person consent first", bn: "আগে সশরীরে সম্মতি", hi: "पहले व्यक्तिगत सहमति", ur: "پہلے ذاتی رضامندی" },
    openTask: { en: "Record call consent", bn: "কল সম্মতি নথিভুক্ত করুন", hi: "कॉल सहमति दर्ज करें", ur: "کال کی رضامندی درج کریں" },
    callbackWindow: { en: "Blocked until consent", bn: "সম্মতির আগে ব্লক", hi: "सहमति तक ब्लॉक", ur: "رضامندی تک بلاک" },
    ironStatus: { en: "No outreach until consent", bn: "সম্মতির আগে আউটরিচ নয়", hi: "सहमति तक आउटरीच नहीं", ur: "رضامندی تک آؤٹ ریچ نہیں" },
    notes: { en: "Policy must deny CALL-E. Visit only.", bn: "পলিসি CALL-E নিষেধ করবে। শুধু ভিজিট।", hi: "पॉलिसी CALL-E रोकती है। केवल विज़िट।", ur: "پالیسی CALL-E روکے گی۔ صرف وزٹ۔" },
    calleScenario: "instant_success",
    maskedPhone: "+880•••555•0109",
    routeOrder: 12,
    timeline: [
      { id: "parveen-t1", at: { en: "Today · policy block", bn: "আজ · পলিসি ব্লক" }, channel: "call-e", outcome: "consent_hold", summary: { en: "Mock CALL-E suppressed: missing consent.", bn: "মক CALL-E বন্ধ: সম্মতি নেই।" } },
    ],
  },
];

export function householdUrgency(household: MockHousehold, language: AppLanguage): string {
  return localize(TONE_URGENCY[household.tone], language);
}

export function getHousehold(id: string | undefined | null): MockHousehold | undefined {
  if (!id) return undefined;
  const normalized = decodeURIComponent(id).trim().toLowerCase();
  return MOCK_HOUSEHOLDS.find((item) => item.id === normalized || item.names.en.toLowerCase() === normalized);
}

export function getHouseholdQueueCopy(language: AppLanguage) {
  return MOCK_HOUSEHOLDS.map((household) => ({
    name: householdName(household, language),
    meta: localize(household.meta, language),
    urgency: localize(TONE_URGENCY[household.tone], language),
    nextAction: localize(household.nextAction, language),
  }));
}

export function householdsToQueue(): { id: string; tone: QueueTone }[] {
  return MOCK_HOUSEHOLDS.map((household) => ({ id: household.id, tone: household.tone }));
}

export type HouseholdFilter = "all" | QueueTone;

export function filterHouseholds(
  language: AppLanguage,
  options: { tone?: HouseholdFilter; query?: string } = {},
): MockHousehold[] {
  const tone = options.tone ?? "all";
  const query = options.query?.trim().toLowerCase() ?? "";
  return MOCK_HOUSEHOLDS.filter((household) => {
    if (tone !== "all" && household.tone !== tone) return false;
    if (!query) return true;
    const haystack = [
      household.id,
      householdName(household, language),
      household.names.en,
      household.names.bn,
      localize(household.village, language),
      household.village.en,
      localize(household.meta, language),
      localize(household.openTask, language),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function householdsByRoute(): MockHousehold[] {
  return [...MOCK_HOUSEHOLDS].sort((a, b) => a.routeOrder - b.routeOrder);
}

export function mockCallLog(): { household: MockHousehold; event: MockTimelineEvent }[] {
  return MOCK_HOUSEHOLDS.flatMap((household) =>
    household.timeline
      .filter((event) => event.channel === "call-e" || event.channel === "missed")
      .map((event) => ({ household, event })),
  );
}

export function countByTone(tone: QueueTone): number {
  return MOCK_HOUSEHOLDS.filter((household) => household.tone === tone).length;
}

export function awaitingCallbackCount(): number {
  return MOCK_HOUSEHOLDS.filter((household) =>
    household.timeline.some((event) => event.outcome === "no_answer" || event.outcome === "voicemail" || event.outcome === "busy" || event.outcome === "callback"),
  ).length;
}

export function safetyReviewCount(): number {
  return MOCK_HOUSEHOLDS.filter((household) => household.timeline.some((event) => event.outcome === "safety")).length;
}

export function consentHoldCount(): number {
  return MOCK_HOUSEHOLDS.filter((household) => household.consent !== "granted").length;
}

export const FIELD_ACTIVITY_COPY: Record<
  "en" | "bn" | "hi" | "ur",
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    routeTitle: string;
    routeBody: (count: number) => string;
    logTitle: string;
    logBody: string;
    village: string;
    prefers: string;
    window: string;
    timeline: string;
    iron: string;
    notes: string;
    awaiting: (count: number) => string;
    searchPlaceholder: string;
    clearSearch: string;
    stop: (order: number) => string;
    outcome: Record<MockCallOutcome, string>;
    channel: Record<MockChannel, string>;
  }
> = {
  en: {
    eyebrow: "FIELD ACTIVITY",
    title: "Today’s mock route",
    subtitle: "Synthetic visits and CALL-E outcomes so the queue feels full without live dials.",
    routeTitle: "Visit order",
    routeBody: (count) => `${count} stops · urgency first`,
    logTitle: "Mock CALL-E log",
    logBody: "Dry-run results only. No live numbers.",
    village: "Village",
    prefers: "Prefers",
    window: "Safe window",
    timeline: "Recent activity",
    iron: "Supplements",
    notes: "CHW note",
    awaiting: (count) => `${count} mock callbacks waiting`,
    searchPlaceholder: "Name or village",
    clearSearch: "Clear search",
    stop: (order) => `Stop ${order}`,
    outcome: {
      completed: "Completed",
      no_answer: "No answer",
      busy: "Busy",
      voicemail: "Voicemail",
      callback: "Callback",
      safety: "Safety review",
      declined: "Declined",
      consent_hold: "Consent hold",
    },
    channel: { "call-e": "CALL-E", visit: "Visit", sms: "SMS", missed: "Missed" },
  },
  bn: {
    eyebrow: "ফিল্ড অ্যাকটিভিটি",
    title: "আজকের মক রুট",
    subtitle: "সিন্থেটিক ভিজিট ও CALL-E ফলাফল — লাইভ ডায়াল ছাড়াই কিউ ভরে থাকে।",
    routeTitle: "ভিজিটের ক্রম",
    routeBody: (count) => `${count}টি স্টপ · জরুরি আগে`,
    logTitle: "মক CALL-E লগ",
    logBody: "শুধু ড্রাই-রান ফলাফল। কোনো লাইভ নম্বর নেই।",
    village: "গ্রাম",
    prefers: "পছন্দের ভাষা",
    window: "নিরাপদ সময়",
    timeline: "সাম্প্রতিক কাজ",
    iron: "সাপ্লিমেন্ট",
    notes: "সিএইচডব্লিউ নোট",
    awaiting: (count) => `${count}টি মক কলব্যাক অপেক্ষা করছে`,
    searchPlaceholder: "নাম বা গ্রাম",
    clearSearch: "সার্চ মুছুন",
    stop: (order) => `স্টপ ${order}`,
    outcome: {
      completed: "সম্পন্ন",
      no_answer: "উত্তর নেই",
      busy: "ব্যস্ত",
      voicemail: "ভয়েসমেইল",
      callback: "কলব্যাক",
      safety: "সেফটি পর্যালোচনা",
      declined: "প্রত্যাখ্যান",
      consent_hold: "সম্মতি স্থগিত",
    },
    channel: { "call-e": "CALL-E", visit: "ভিজিট", sms: "এসএমএস", missed: "মিসড" },
  },
  hi: {
    eyebrow: "फ़ील्ड गतिविधि",
    title: "आज का मॉक रूट",
    subtitle: "सिंथेटिक विज़िट और CALL-E परिणाम — बिना लाइव डायल के क्यू भरी रहे।",
    routeTitle: "विज़िट क्रम",
    routeBody: (count) => `${count} स्टॉप · अत्यावश्यक पहले`,
    logTitle: "मॉक CALL-E लॉग",
    logBody: "केवल ड्राई-रन परिणाम। कोई लाइव नंबर नहीं।",
    village: "गाँव",
    prefers: "पसंदीदा भाषा",
    window: "सुरक्षित समय",
    timeline: "हाल की गतिविधि",
    iron: "सप्लीमेंट",
    notes: "सीएचडब्ल्यू नोट",
    awaiting: (count) => `${count} मॉक कॉलबैक प्रतीक्षा में`,
    searchPlaceholder: "नाम या गाँव",
    clearSearch: "खोज साफ़ करें",
    stop: (order) => `स्टॉप ${order}`,
    outcome: {
      completed: "पूरा",
      no_answer: "कोई जवाब नहीं",
      busy: "व्यस्त",
      voicemail: "वॉइसमेल",
      callback: "कॉलबैक",
      safety: "सुरक्षा समीक्षा",
      declined: "अस्वीकृत",
      consent_hold: "सहमति रुकी",
    },
    channel: { "call-e": "CALL-E", visit: "विज़िट", sms: "एसएमएस", missed: "मिस्ड" },
  },
  ur: {
    eyebrow: "فیلڈ سرگرمی",
    title: "آج کا ماک روٹ",
    subtitle: "مصنوعی وزٹس اور CALL-E نتائج — لائیو ڈائل کے بغیر قطار بھری رہے۔",
    routeTitle: "وزٹ ترتیب",
    routeBody: (count) => `${count} سٹاپس · فوری پہلے`,
    logTitle: "ماک CALL-E لاگ",
    logBody: "صرف ڈرائی رن نتائج۔ کوئی لائیو نمبر نہیں۔",
    village: "گاؤں",
    prefers: "ترجیحی زبان",
    window: "محفوظ وقت",
    timeline: "حالیہ سرگرمی",
    iron: "سپلیمنٹس",
    notes: "سی ایچ ڈبلیو نوٹ",
    awaiting: (count) => `${count} ماک کال بیکس انتظار میں`,
    searchPlaceholder: "نام یا گاؤں",
    clearSearch: "تلاش صاف کریں",
    stop: (order) => `سٹاپ ${order}`,
    outcome: {
      completed: "مکمل",
      no_answer: "جواب نہیں",
      busy: "مصروف",
      voicemail: "وائس میل",
      callback: "کال بیک",
      safety: "سیفٹی جائزہ",
      declined: "مسترد",
      consent_hold: "رضامندی روکی گئی",
    },
    channel: { "call-e": "CALL-E", visit: "وزٹ", sms: "ایس ایم ایس", missed: "مسڈ" },
  },
};

export function getFieldActivityCopy(language: AppLanguage) {
  return FIELD_ACTIVITY_COPY[language as "en" | "bn" | "hi" | "ur"] ?? FIELD_ACTIVITY_COPY.en;
}
