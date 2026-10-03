import type { AppLanguage } from "@/lib/language";

type OfflineContentCopy = { label: string; detail: (count: number) => string; title: string; body: string };

const copyByLanguage: Record<AppLanguage, OfflineContentCopy> = {
  en: { label: "Offline care guidance", detail: (count) => `${count} essential topics available without internet`, title: "Offline care guidance", body: "Warning signs, care visits, nutrition, and privacy guidance are available on this device without using data." },
  bn: { label: "অফলাইন যত্নের নির্দেশনা", detail: (count) => `ইন্টারনেট ছাড়া ${count}টি জরুরি বিষয় পাওয়া যাবে`, title: "অফলাইন যত্নের নির্দেশনা", body: "বিপদের লক্ষণ, যত্নের ভিজিট, পুষ্টি ও গোপনীয়তার নির্দেশনা ডেটা ছাড়াই এই ডিভাইসে পাওয়া যাবে।" },
  hi: { label: "ऑफलाइन देखभाल मार्गदर्शन", detail: (count) => `इंटरनेट के बिना ${count} जरूरी विषय उपलब्ध`, title: "ऑफलाइन देखभाल मार्गदर्शन", body: "खतरे के संकेत, देखभाल विज़िट, पोषण और गोपनीयता की जानकारी बिना डेटा के इस डिवाइस पर उपलब्ध है।" },
  ur: { label: "آف لائن نگہداشت کی رہنمائی", detail: (count) => `${count} ضروری موضوعات انٹرنیٹ کے بغیر دستیاب ہیں`, title: "آف لائن نگہداشت کی رہنمائی", body: "خطرے کی علامات، نگہداشت کے وزٹ، غذائیت اور رازداری کی رہنمائی اس ڈیوائس پر ڈیٹا کے بغیر دستیاب ہے۔" },
  ta: { label: "ஆஃப்லைன் பராமரிப்பு வழிகாட்டி", detail: (count) => `இணையம் இல்லாமல் ${count} முக்கிய தலைப்புகள் கிடைக்கும்`, title: "ஆஃப்லைன் பராமரிப்பு வழிகாட்டி", body: "எச்சரிக்கை அறிகுறிகள், பராமரிப்பு வருகைகள், ஊட்டச்சத்து மற்றும் தனியுரிமை வழிகாட்டி தரவு இல்லாமல் இந்த சாதனத்தில் கிடைக்கும்." },
  te: { label: "ఆఫ్‌లైన్ సంరక్షణ మార్గదర్శకం", detail: (count) => `ఇంటర్నెట్ లేకుండా ${count} ముఖ్య అంశాలు అందుబాటులో ఉన్నాయి`, title: "ఆఫ్‌లైన్ సంరక్షణ మార్గదర్శకం", body: "హెచ్చరిక సంకేతాలు, సంరక్షణ సందర్శనలు, పోషణ మరియు గోప్యత మార్గదర్శకం డేటా లేకుండా ఈ పరికరంలో అందుబాటులో ఉంటుంది." },
};

export function getOfflineContentCopy(language: AppLanguage): OfflineContentCopy {
  return copyByLanguage[language] ?? copyByLanguage.en;
}
