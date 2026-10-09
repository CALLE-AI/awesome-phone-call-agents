import type { AppLanguage } from "@/lib/language";

type OfflineHomeCopy = { questionLabel: string; resumeTitle: string; resumeBody: (question: number, total: number) => string; resumeAction: string; guidanceTitle: string; guidanceBody: string; guidanceAction: string };

const copyByLanguage: Record<AppLanguage, OfflineHomeCopy> = {
  en: { questionLabel: "Question", resumeTitle: "Offline check-in ready", resumeBody: (question, total) => `Saved progress: question ${question} of ${total}.`, resumeAction: "Resume", guidanceTitle: "Need local care guidance?", guidanceBody: "Clinic and community-health-worker guidance is available without internet.", guidanceAction: "Open guidance" },
  bn: { questionLabel: "প্রশ্ন", resumeTitle: "অফলাইন চেক-ইন প্রস্তুত", resumeBody: (question, total) => `সংরক্ষিত অগ্রগতি: ${total}টির মধ্যে ${question} নম্বর প্রশ্ন।`, resumeAction: "চালিয়ে যান", guidanceTitle: "স্থানীয় যত্নের নির্দেশনা দরকার?", guidanceBody: "ক্লিনিক ও কমিউনিটি হেলথ ওয়ার্কারের নির্দেশনা ইন্টারনেট ছাড়াই পাওয়া যায়।", guidanceAction: "নির্দেশনা খুলুন" },
  hi: { questionLabel: "प्रश्न", resumeTitle: "ऑफलाइन चेक-इन तैयार", resumeBody: (question, total) => `सहेजी गई प्रगति: ${total} में से प्रश्न ${question}.`, resumeAction: "जारी रखें", guidanceTitle: "स्थानीय देखभाल की जानकारी चाहिए?", guidanceBody: "क्लिनिक और कम्युनिटी हेल्थ वर्कर की जानकारी बिना इंटरनेट उपलब्ध है।", guidanceAction: "जानकारी खोलें" },
  ur: { questionLabel: "سوال", resumeTitle: "آف لائن چیک اِن تیار ہے", resumeBody: (question, total) => `محفوظ پیش رفت: ${total} میں سے سوال ${question}۔`, resumeAction: "جاری رکھیں", guidanceTitle: "مقامی نگہداشت کی رہنمائی چاہیے؟", guidanceBody: "کلینک اور کمیونٹی ہیلتھ ورکر کی رہنمائی انٹرنیٹ کے بغیر دستیاب ہے۔", guidanceAction: "رہنمائی کھولیں" },
  ta: { questionLabel: "கேள்வி", resumeTitle: "ஆஃப்லைன் செக்-இன் தயார்", resumeBody: (question, total) => `சேமித்த முன்னேற்றம்: ${total} இல் கேள்வி ${question}.`, resumeAction: "தொடரவும்", guidanceTitle: "உள்ளூர் பராமரிப்பு வழிகாட்டுதல் தேவையா?", guidanceBody: "கிளினிக் மற்றும் சமூக சுகாதார பணியாளர் வழிகாட்டுதல் இணையம் இல்லாமலும் கிடைக்கும்.", guidanceAction: "வழிகாட்டுதலைத் திறக்கவும்" },
  te: { questionLabel: "ప్రశ్న", resumeTitle: "ఆఫ్‌లైన్ చెక్-ఇన్ సిద్ధంగా ఉంది", resumeBody: (question, total) => `సేవ్ చేసిన పురోగతి: ${total}లో ప్రశ్న ${question}.`, resumeAction: "కొనసాగించండి", guidanceTitle: "స్థానిక సంరక్షణ మార్గదర్శకం కావాలా?", guidanceBody: "క్లినిక్ మరియు కమ్యూనిటీ హెల్త్ వర్కర్ మార్గదర్శకం ఇంటర్నెట్ లేకుండానే అందుబాటులో ఉంటుంది.", guidanceAction: "మార్గదర్శకం తెరవండి" },
};

export function getOfflineHomeCopy(language: AppLanguage): OfflineHomeCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
