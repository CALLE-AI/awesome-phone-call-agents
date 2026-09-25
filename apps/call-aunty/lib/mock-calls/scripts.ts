import type { AppLanguage } from "@/lib/language";
import { getLanguageDirection } from "@/lib/language";
import type { CallScriptKey, MockCallScenario, MockTurn, SurveyQuestion } from "./types";
import { CALL_AUNTY_SURVEY } from "./survey";

export type LocalizedQuestionCopy = {
  prompt: string;
  options?: string[];
};

export type CallScriptPack = {
  locale: AppLanguage;
  direction: "ltr" | "rtl";
  frames: Record<CallScriptKey, string>;
  questions: Record<string, LocalizedQuestionCopy>;
};

function pack(
  locale: AppLanguage,
  frames: Record<CallScriptKey, string>,
  questions: Record<string, LocalizedQuestionCopy>,
): CallScriptPack {
  return { locale, direction: getLanguageDirection(locale), frames, questions };
}

const EN_FRAMES: Record<CallScriptKey, string> = {
  greeting_named: "Hello, this is the Call Aunty research assistant. Am I speaking with {name}?",
  greeting_generic: "Hello. I am calling with a short fictional survey. Is now a good time?",
  consent_prompt:
    "This is a fictional survey for testing. Is now a good time to answer a short survey, and may I record your answers for this survey?",
  thanks_testing: "Thanks. This is a fictional survey for testing.",
  decline_close: "No problem at all. I will not continue the survey. Thank you for your time.",
  reschedule_offer: "Absolutely. I can mark this as a requested callback. Would {time} be suitable?",
  reschedule_ack: "I will not start the survey now. We can continue at the requested time.",
  skip_no_followup: "Understood. No follow-up contact will be requested.",
  voicemail:
    "Hello, this is the Call Aunty research assistant. Please call back using the official callback channel if you would like to participate in the fictional survey. Goodbye.",
  complete: "Thank you, {name}. That completes the fictional survey.",
  acknowledge_negative:
    "Thank you for telling me. I will not ask you to rate or recommend the service. We can skip anything you do not want to answer.",
  offer_skip: "Would you like to skip the remaining optional questions?",
  safety_stop_probing:
    "I hear this may need in-person care. I will not ask more detail. Please seek urgent in-person care now. A health worker can follow up. I am stopping the remaining optional questions.",
  q06_careful: "If you are willing, was there anything confusing or frustrating? You can skip this.",
  system_reschedule: "State transition: in_progress -> rescheduled; callback requested for {time} local time.",
  system_voicemail: "Voicemail detected. Mark call as voicemail and do not initialize survey state.",
  system_transport: "Transport interruption. Persist cursor at {questionId} before retrying. Do not restart from consent.",
  system_safety:
    "State: distress detected. Skip remaining optional questions. Persist a safety code, not a quotable narrative. Escalate to human follow-up.",
};

export const CALL_AUNTY_SCRIPT_PACKS: Record<AppLanguage, CallScriptPack> = {
  en: pack("en", EN_FRAMES, Object.fromEntries(CALL_AUNTY_SURVEY.map((question) => [question.id, { prompt: question.prompt, options: question.options }]))),
  bn: pack(
    "bn",
    {
      greeting_named: "হ্যালো, আমি কল আন্টি গবেষণা সহকারী। আমি কি {name}-এর সঙ্গে কথা বলছি?",
      greeting_generic: "হ্যালো। আমি একটি ছোট কাল্পনিক জরিপ নিয়ে কল করেছি। এখন কি ভালো সময়?",
      consent_prompt:
        "এটি পরীক্ষার জন্য একটি কাল্পনিক জরিপ। এখন কি একটি ছোট জরিপের উত্তর দেওয়ার ভালো সময়, এবং এই জরিপের জন্য আপনার উত্তর লিখে রাখতে পারি?",
      thanks_testing: "ধন্যবাদ। এটি পরীক্ষার জন্য একটি কাল্পনিক জরিপ।",
      decline_close: "কোনো সমস্যা নেই। আমি জরিপ চালাব না। আপনার সময়ের জন্য ধন্যবাদ।",
      reschedule_offer: "অবশ্যই। আমি এটি ফিরে কলের অনুরোধ হিসেবে চিহ্নিত করতে পারি। {time} কি সুবিধাজনক?",
      reschedule_ack: "আমি এখন জরিপ শুরু করব না। অনুরোধ করা সময়ে আমরা চালিয়ে যেতে পারি।",
      skip_no_followup: "বুঝেছি। কোনো ফলো-আপ যোগাযোগ চাওয়া হবে না।",
      voicemail:
        "হ্যালো, আমি কল আন্টি গবেষণা সহকারী। কাল্পনিক জরিপে অংশ নিতে চাইলে অফিসিয়াল কলব্যাক চ্যানেল দিয়ে ফিরে কল করুন। বিদায়।",
      complete: "ধন্যবাদ, {name}। কাল্পনিক জরিপ এখানে শেষ।",
      acknowledge_negative:
        "বলার জন্য ধন্যবাদ। আমি সেবা রেট বা সুপারিশ করতে বলব না। যা উত্তর দিতে চান না, তা বাদ দিতে পারেন।",
      offer_skip: "বাকি ঐচ্ছিক প্রশ্নগুলো বাদ দিতে চান?",
      safety_stop_probing:
        "এটি ব্যক্তিগত যত্নের প্রয়োজন হতে পারে। আমি আর বিস্তারিত জিজ্ঞাসা করব না। এখনই জরুরি ব্যক্তিগত যত্ন নিন। একজন স্বাস্থ্যকর্মী ফলো-আপ করতে পারেন। বাকি ঐচ্ছিক প্রশ্ন আমি বন্ধ করছি।",
      q06_careful: "যদি বলতে চান, কিছু কি বিভ্রান্তিকর বা বিরক্তিকর ছিল? এড়িয়ে যেতে পারেন।",
      system_reschedule: "অবস্থা পরিবর্তন: in_progress -> rescheduled; স্থানীয় সময় {time}-এ কলব্যাক অনুরোধ।",
      system_voicemail: "ভয়েসমেল ধরা পড়েছে। কল ভয়েসমেল হিসেবে চিহ্নিত করুন এবং জরিপ শুরু করবেন না।",
      system_transport: "সংযোগ বিচ্ছিন্ন। আবার চেষ্টা করার আগে কার্সর {questionId}-এ রাখুন। সম্মতি থেকে আবার শুরু করবেন না।",
      system_safety:
        "অবস্থা: কষ্টের ইঙ্গিত। বাকি ঐচ্ছিক প্রশ্ন বাদ দিন। উদ্ধৃত করার মতো বিবরণ নয়, নিরাপত্তা কোড রাখুন। মানুষের ফলো-আপে পাঠান।",
    },
    {
      consent: { prompt: "এখন কি একটি ছোট জরিপের উত্তর দেওয়ার ভালো সময়, এবং এই জরিপের জন্য আপনার উত্তর লিখে রাখতে পারি?" },
      q01: {
        prompt: "সেবার সঙ্গে আপনার সামগ্রিক অভিজ্ঞতা কেমন ছিল?",
        options: ["খুব ইতিবাচক", "কিছুটা ইতিবাচক", "মাঝারি", "কিছুটা নেতিবাচক", "খুব নেতিবাচক"],
      },
      q02: { prompt: "প্রয়োজনীয় সাহায্য বা তথ্য পাওয়া কতটা সহজ ছিল?" },
      q03: { prompt: "আপনি যে নির্দেশনা পেয়েছিলেন, তা কতটা পরিষ্কার ছিল?" },
      q04: { prompt: "যে সময় লেগেছিল, তাতে আপনি কতটা সন্তুষ্ট?" },
      q05: {
        prompt: "অভিজ্ঞতার কোন অংশগুলো আপনার জন্য সবচেয়ে ভালো কাজ করেছে?",
        options: ["ব্যবহার সহজ", "কর্মীদের সহায়তা", "গতি", "স্পষ্টতা", "সুবিধা", "ফলো-আপ"],
      },
      q06: { prompt: "কিছু কি বিভ্রান্তিকর বা বিরক্তিকর ছিল?" },
      q07: { prompt: "আপনি যা করতে চেয়েছিলেন, তা কি শেষ করতে পেরেছিলেন?" },
      q08: { prompt: "একটি জিনিস বদলাতে পারলে, সেটি কী হতো?" },
      q09: { prompt: "আবার এই সেবা ব্যবহার করার সম্ভাবনা কতটা?" },
      q10: { prompt: "পরিচিত কাউকে এই সেবা সুপারিশ করার সম্ভাবনা কতটা?" },
      q11: { prompt: "প্রশ্ন করার যথেষ্ট সুযোগ পেয়েছেন বলে মনে হয়েছে কি?" },
      q12: { prompt: "যিনি সাহায্য করেছিলেন, তিনি কি আপনার উদ্বেগ শুনেছেন?" },
      q13: {
        prompt: "আপনি যে ফলো-আপ আশা করেছিলেন, তা কি পেয়েছেন?",
        options: ["হ্যাঁ", "আংশিক", "না", "প্রযোজ্য নয়"],
      },
      q14: { prompt: "সময় বা সহজলভ্যতা কতটা সুবিধাজনক ছিল?" },
      q15: { prompt: "আপনি সবচেয়ে বড় কী উপকার পেয়েছেন?" },
      q16: { prompt: "সবচেয়ে বড় কী উন্নতির পরামর্শ দেবেন?" },
      q17: { prompt: "এমন কিছু গুরুত্বপূর্ণ আছে যা আমরা জিজ্ঞাসা করিনি?" },
      q18: { prompt: "আপনার মতামত নিয়ে কেউ যোগাযোগ করুক, তা কি চান?" },
      q19: {
        prompt: "যোগাযোগের পছন্দের উপায় কী?",
        options: ["ফোন", "ইমেইল", "টেক্সট", "ফলো-আপ নয়"],
      },
      q20: { prompt: "অভ্যন্তরীণ সারাংশে আপনার মন্তব্য কি বেনামে উদ্ধৃত করা যাবে?" },
    },
  ),
  hi: pack(
    "hi",
    {
      greeting_named: "नमस्ते, मैं कॉल आंटी शोध सहायक हूँ। क्या मैं {name} से बात कर रही हूँ?",
      greeting_generic: "नमस्ते। मैं एक छोटा काल्पनिक सर्वे लेकर कॉल कर रही हूँ। क्या अभी समय ठीक है?",
      consent_prompt:
        "यह परीक्षण के लिए एक काल्पनिक सर्वे है। क्या अभी छोटे सर्वे के जवाब देने का अच्छा समय है, और क्या मैं इस सर्वे के लिए आपके जवाब दर्ज करूँ?",
      thanks_testing: "धन्यवाद। यह परीक्षण के लिए एक काल्पनिक सर्वे है।",
      decline_close: "कोई बात नहीं। मैं सर्वे जारी नहीं रखूँगी। आपके समय के लिए धन्यवाद।",
      reschedule_offer: "ज़रूर। मैं इसे कॉलबैक अनुरोध के रूप में दर्ज कर सकती हूँ। क्या {time} ठीक रहेगा?",
      reschedule_ack: "मैं अभी सर्वे शुरू नहीं करूँगी। अनुरोध किए समय हम जारी रख सकते हैं।",
      skip_no_followup: "समझ गई। कोई फॉलो-अप संपर्क नहीं माँगा जाएगा।",
      voicemail:
        "नमस्ते, मैं कॉल आंटी शोध सहायक हूँ। काल्पनिक सर्वे में भाग लेना हो तो आधिकारिक कॉलबैक चैनल से वापस कॉल करें। अलविदा।",
      complete: "धन्यवाद, {name}। काल्पनिक सर्वे यहीं पूरा हुआ।",
      acknowledge_negative:
        "बताने के लिए धन्यवाद। मैं सेवा को रेट या सिफारिश करने को नहीं कहूँगी। जो नहीं बताना चाहें, उसे छोड़ सकते हैं।",
      offer_skip: "क्या बाकी वैकल्पिक प्रश्न छोड़ना चाहेंगे?",
      safety_stop_probing:
        "यह व्यक्तिगत देखभाल की ज़रूरत हो सकती है। मैं और विस्तार नहीं पूछूँगी। अभी तत्काल व्यक्तिगत देखभाल लें। कोई स्वास्थ्य कार्यकर्ता फॉलो-अप कर सकता है। बाकी वैकल्पिक प्रश्न मैं रोक रही हूँ।",
      q06_careful: "अगर बताना चाहें, तो क्या कुछ भ्रमित या परेशान करने वाला था? इसे छोड़ सकते हैं।",
      system_reschedule: "स्थिति परिवर्तन: in_progress -> rescheduled; स्थानीय समय {time} पर कॉलबैक अनुरोध।",
      system_voicemail: "वॉइसमेल मिला। कॉल को वॉइसमेल चिह्नित करें और सर्वे शुरू न करें।",
      system_transport: "कनेक्शन टूटा। फिर कोशिश से पहले कर्सर {questionId} पर रखें। सहमति से दोबारा शुरू न करें।",
      system_safety:
        "स्थिति: संकट का संकेत। बाकी वैकल्पिक प्रश्न छोड़ें। उद्धरण योग्य विवरण नहीं, सुरक्षा कोड रखें। मानव फॉलो-अप पर भेजें।",
    },
    {
      consent: { prompt: "क्या अभी एक छोटे सर्वे के जवाब देने का अच्छा समय है, और क्या मैं इस सर्वे के लिए आपके जवाब दर्ज करूँ?" },
      q01: {
        prompt: "सेवा के साथ आपका कुल अनुभव कैसा रहा?",
        options: ["बहुत सकारात्मक", "कुछ सकारात्मक", "सामान्य", "कुछ नकारात्मक", "बहुत नकारात्मक"],
      },
      q02: { prompt: "जरूरी मदद या जानकारी पाना कितना आसान था?" },
      q03: { prompt: "जो निर्देश मिले, वे कितने स्पष्ट थे?" },
      q04: { prompt: "जो समय लगा, उससे आप कितने संतुष्ट थे?" },
      q05: {
        prompt: "अनुभव के कौन से हिस्से आपके लिए सबसे अच्छे रहे?",
        options: ["आसान उपयोग", "कर्मचारी मदद", "गति", "स्पष्टता", "सुविधा", "फॉलो-अप"],
      },
      q06: { prompt: "क्या कुछ भ्रमित या परेशान करने वाला था?" },
      q07: { prompt: "जो काम आप करना चाहते थे, क्या वह पूरा हो पाया?" },
      q08: { prompt: "एक चीज़ बदल सकते तो वह क्या होती?" },
      q09: { prompt: "सेवा को फिर से इस्तेमाल करने की कितनी संभावना है?" },
      q10: { prompt: "किसी जानकार को यह सेवा सुझाने की कितनी संभावना है?" },
      q11: { prompt: "क्या आपको प्रश्न पूछने का पर्याप्त अवसर मिला?" },
      q12: { prompt: "मदद करने वाले व्यक्ति ने आपकी चिंताएँ सुनीं?" },
      q13: {
        prompt: "जो फॉलो-अप आप उम्मीद कर रहे थे, क्या वह मिला?",
        options: ["हाँ", "आंशिक", "नहीं", "लागू नहीं"],
      },
      q14: { prompt: "समय या उपलब्धता कितनी सुविधाजनक थी?" },
      q15: { prompt: "सबसे बड़ा क्या लाभ मिला?" },
      q16: { prompt: "सबसे बड़ा कौन सा सुधार सुझाएँगे?" },
      q17: { prompt: "कोई ज़रूरी बात है जो हमने नहीं पूछी?" },
      q18: { prompt: "क्या कोई आपकी प्रतिक्रिया पर संपर्क करे, यह चाहेंगे?" },
      q19: {
        prompt: "संपर्क का पसंदीदा तरीका क्या है?",
        options: ["फ़ोन", "ईमेल", "संदेश", "कोई फॉलो-अप नहीं"],
      },
      q20: { prompt: "क्या आपकी टिप्पणी आंतरिक सारांश में बिना नाम के उद्धृत की जा सकती है?" },
    },
  ),
  ur: pack(
    "ur",
    {
      greeting_named: "السلام علیکم، میں کال آنٹی تحقیقی معاون ہوں۔ کیا میں {name} سے بات کر رہی ہوں؟",
      greeting_generic: "السلام علیکم۔ میں ایک مختصر فرضی سروے کے لیے کال کر رہی ہوں۔ کیا اب وقت مناسب ہے؟",
      consent_prompt:
        "یہ آزمائش کے لیے ایک فرضی سروے ہے۔ کیا اب مختصر سروے کے جواب کا اچھا وقت ہے، اور کیا میں اس سروے کے لیے آپ کے جوابات درج کر سکتی ہوں؟",
      thanks_testing: "شکریہ۔ یہ آزمائش کے لیے ایک فرضی سروے ہے۔",
      decline_close: "کوئی بات نہیں۔ میں سروے جاری نہیں رکھوں گی۔ آپ کے وقت کا شکریہ۔",
      reschedule_offer: "ضرور۔ میں اسے کال بیک کی درخواست کے طور پر درج کر سکتی ہوں۔ کیا {time} مناسب رہے گا؟",
      reschedule_ack: "میں اب سروے شروع نہیں کروں گی۔ درخواست کردہ وقت پر ہم جاری رکھ سکتے ہیں۔",
      skip_no_followup: "سمجھ گئی۔ کوئی فالو اپ رابطہ نہیں مانگا جائے گا۔",
      voicemail:
        "السلام علیکم، میں کال آنٹی تحقیقی معاون ہوں۔ فرضی سروے میں حصہ لینا ہو تو سرکاری کال بیک چینل سے واپس کال کریں۔ خدا حافظ۔",
      complete: "شکریہ، {name}۔ فرضی سروے یہاں مکمل ہوا۔",
      acknowledge_negative:
        "بتانے کا شکریہ۔ میں سروس کی درجہ بندی یا سفارش نہیں پوچھوں گی۔ جو نہیں بتانا چاہیں، اسے چھوڑ سکتے ہیں۔",
      offer_skip: "کیا باقی اختیاری سوالات چھوڑنا چاہیں گے؟",
      safety_stop_probing:
        "اس کے لیے ذاتی نگہداشت درکار ہو سکتی ہے۔ میں مزید تفصیل نہیں پوچھوں گی۔ ابھی فوری ذاتی نگہداشت لیں۔ کوئی صحت کارکن فالو اپ کر سکتا ہے۔ باقی اختیاری سوالات میں روک رہی ہوں۔",
      q06_careful: "اگر بتانا چاہیں تو کیا کچھ الجھاؤ یا پریشانی والی بات تھی؟ اسے چھوڑ سکتے ہیں۔",
      system_reschedule: "حالت کی تبدیلی: in_progress -> rescheduled؛ مقامی وقت {time} پر کال بیک کی درخواست۔",
      system_voicemail: "وائس میل ملی۔ کال کو وائس میل نشان زد کریں اور سروے شروع نہ کریں۔",
      system_transport: "رابطہ ٹوٹا۔ دوبارہ کوشش سے پہلے کرسر {questionId} پر رکھیں۔ رضامندی سے دوبارہ شروع نہ کریں۔",
      system_safety:
        "حالت: تکلیف کا اشارہ۔ باقی اختیاری سوالات چھوڑیں۔ اقتباس کے قابل بیان نہیں، حفاظتی کوڈ رکھیں۔ انسانی فالو اپ پر بھیجیں۔",
    },
    {
      consent: { prompt: "کیا اب ایک مختصر سروے کے جواب کا اچھا وقت ہے، اور کیا میں اس سروے کے لیے آپ کے جوابات درج کر سکتی ہوں؟" },
      q01: {
        prompt: "سروس کے ساتھ آپ کا مجموعی تجربہ کیسا رہا؟",
        options: ["بہت مثبت", "کچھ مثبت", "درمیانہ", "کچھ منفی", "بہت منفی"],
      },
      q02: { prompt: "ضروری مدد یا معلومات حاصل کرنا کتنا آسان تھا؟" },
      q03: { prompt: "جو ہدایات ملیں، وہ کتنی واضح تھیں؟" },
      q04: { prompt: "جو وقت لگا، اس سے آپ کتنے مطمئن تھے؟" },
      q05: {
        prompt: "تجربے کے کون سے حصے آپ کے لیے سب سے بہتر رہے؟",
        options: ["آسان استعمال", "عملے کی مدد", "رفتار", "وضاحت", "سہولت", "فالو اپ"],
      },
      q06: { prompt: "کیا کچھ الجھاؤ یا پریشانی والی بات تھی؟" },
      q07: { prompt: "جو کام آپ کرنا چاہتے تھے، کیا وہ مکمل ہو سکا؟" },
      q08: { prompt: "ایک چیز بدل سکتے تو وہ کیا ہوتی؟" },
      q09: { prompt: "سروس دوبارہ استعمال کرنے کا امکان کتنا ہے؟" },
      q10: { prompt: "کسی جاننے والے کو یہ سروس تجویز کرنے کا امکان کتنا ہے؟" },
      q11: { prompt: "کیا آپ کو سوال پوچھنے کا کافی موقع ملا؟" },
      q12: { prompt: "مدد کرنے والے نے آپ کی فکر سنی؟" },
      q13: {
        prompt: "جو فالو اپ آپ توقع کر رہے تھے، کیا وہ ملا؟",
        options: ["ہاں", "جزوی", "نہیں", "لاگو نہیں"],
      },
      q14: { prompt: "وقت یا دستیابی کتنی آسان تھی؟" },
      q15: { prompt: "سب سے بڑا کیا فائدہ ملا؟" },
      q16: { prompt: "سب سے بڑی کون سی بہتری تجویز کریں گے؟" },
      q17: { prompt: "کوئی اہم بات ہے جو ہم نے نہیں پوچھی؟" },
      q18: { prompt: "کیا کوئی آپ کی رائے پر رابطہ کرے، یہ چاہیں گے؟" },
      q19: {
        prompt: "رابطے کا پسندیدہ طریقہ کیا ہے؟",
        options: ["فون", "ای میل", "پیغام", "کوئی فالو اپ نہیں"],
      },
      q20: { prompt: "کیا آپ کی رائے اندرونی خلاصے میں بغیر نام کے نقل کی جا سکتی ہے؟" },
    },
  ),
  ta: pack(
    "ta",
    {
      greeting_named: "வணக்கம், நான் கால் ஆன்டி ஆய்வு உதவியாளர். நான் {name} உடன் பேசுகிறேனா?",
      greeting_generic: "வணக்கம். ஒரு சிறிய கற்பனை கணக்கெடுப்புக்காக அழைக்கிறேன். இப்போது நேரம் சரியா?",
      consent_prompt:
        "இது சோதனைக்கான கற்பனை கணக்கெடுப்பு. இப்போது சிறிய கணக்கெடுப்புக்கு பதில் சொல்ல ஏற்ற நேரமா, இந்த கணக்கெடுப்புக்காக உங்கள் பதில்களை பதிவு செய்யலாமா?",
      thanks_testing: "நன்றி. இது சோதனைக்கான கற்பனை கணக்கெடுப்பு.",
      decline_close: "பிரச்சினை இல்லை. நான் கணக்கெடுப்பை தொடரமாட்டேன். உங்கள் நேரத்திற்கு நன்றி.",
      reschedule_offer: "நிச்சயம். இதை மீண்டும் அழைப்பு கோரிக்கையாக குறிக்கலாம். {time} பொருந்துமா?",
      reschedule_ack: "இப்போது கணக்கெடுப்பை தொடங்கமாட்டேன். கேட்ட நேரத்தில் தொடரலாம்.",
      skip_no_followup: "புரிந்தது. தொடர் தொடர்பு கேட்கப்படாது.",
      voicemail:
        "வணக்கம், நான் கால் ஆன்டி ஆய்வு உதவியாளர். கற்பனை கணக்கெடுப்பில் பங்கேற்க விரும்பினால் அதிகாரப்பூர்வ மீண்டும் அழைப்பு வழி வழியாக அழையுங்கள். பிரியாவிடை.",
      complete: "நன்றி, {name}. கற்பனை கணக்கெடுப்பு இத்துடன் முடிந்தது.",
      acknowledge_negative:
        "சொன்னதற்கு நன்றி. சேவையை மதிப்பிடவோ பரிந்துரைக்கவோ கேட்கமாட்டேன். விரும்பாததை தவிர்க்கலாம்.",
      offer_skip: "மீதி விருப்ப கேள்விகளை தவிர்க்க விரும்புகிறீர்களா?",
      safety_stop_probing:
        "இதற்கு நேரில் பராமரிப்பு தேவைப்படலாம். மேலும் விவரம் கேட்கமாட்டேன். இப்போதே அவசர நேரில் பராமரிப்பு பெறுங்கள். ஒரு சுகாதார பணியாளர் தொடரலாம். மீதி விருப்ப கேள்விகளை நிறுத்துகிறேன்.",
      q06_careful: "சொல்ல விரும்பினால், குழப்பமான அல்லது சிரமமான ஏதேனும் இருந்ததா? இதை தவிர்க்கலாம்.",
      system_reschedule: "நிலை மாற்றம்: in_progress -> rescheduled; உள்ளூர் நேரம் {time} மீண்டும் அழைப்பு கோரிக்கை.",
      system_voicemail: "குரல் அஞ்சல் கண்டறியப்பட்டது. அழைப்பை குரல் அஞ்சலாக குறித்து கணக்கெடுப்பை தொடங்க வேண்டாம்.",
      system_transport: "இணைப்பு துண்டிந்தது. மீண்டும் முயலும் முன் கர்சரை {questionId} இல் வைக்கவும். ஒப்புதலில் இருந்து மீண்டும் தொடங்க வேண்டாம்.",
      system_safety:
        "நிலை: துயரம் கண்டறியப்பட்டது. மீதி விருப்ப கேள்விகளை தவிர்க்கவும். மேற்கோள் விவரிப்பு அல்ல, பாதுகாப்பு குறியீடு வைக்கவும். மனித தொடர்ச்சிக்கு அனுப்பவும்.",
    },
    {
      consent: { prompt: "இப்போது ஒரு சிறிய கணக்கெடுப்புக்கு பதில் சொல்ல ஏற்ற நேரமா, இந்த கணக்கெடுப்புக்காக உங்கள் பதில்களை பதிவு செய்யலாமா?" },
      q01: {
        prompt: "சேவையுடனான உங்கள் ஒட்டுமொத்த அனுபவம் எப்படி இருந்தது?",
        options: ["மிக நேர்மறை", "சற்று நேர்மறை", "நடுநிலை", "சற்று எதிர்மறை", "மிக எதிர்மறை"],
      },
      q02: { prompt: "தேவையான உதவி அல்லது தகவலை பெறுவது எவ்வளவு எளிதாக இருந்தது?" },
      q03: { prompt: "நீங்கள் பெற்ற வழிகாட்டுதல் எவ்வளவு தெளிவாக இருந்தது?" },
      q04: { prompt: "ஆன நேரத்தில் எவ்வளவு திருப்தி அடைந்தீர்கள்?" },
      q05: {
        prompt: "அனுபவத்தின் எந்த பகுதிகள் உங்களுக்கு சிறப்பாக அமைந்தன?",
        options: ["எளிய பயன்பாடு", "பணியாளர் உதவி", "வேகம்", "தெளிவு", "வசதி", "தொடர் கவனிப்பு"],
      },
      q06: { prompt: "குழப்பமான அல்லது சிரமமான ஏதேனும் இருந்ததா?" },
      q07: { prompt: "நீங்கள் செய்ய விரும்பியதை முடிக்க முடிந்ததா?" },
      q08: { prompt: "ஒரு விஷயத்தை மாற்ற முடிந்தால், அது என்னவாக இருக்கும்?" },
      q09: { prompt: "சேவையை மீண்டும் பயன்படுத்தும் வாய்ப்பு எவ்வளவு?" },
      q10: { prompt: "தெரிந்த ஒருவருக்கு இந்த சேவையை பரிந்துரைக்கும் வாய்ப்பு எவ்வளவு?" },
      q11: { prompt: "கேள்வி கேட்க போதிய வாய்ப்பு கிடைத்ததாக உணர்ந்தீர்களா?" },
      q12: { prompt: "உதவியவர் உங்கள் கவலைகளை கேட்டாரா?" },
      q13: {
        prompt: "நீங்கள் எதிர்பார்த்த தொடர் கவனிப்பு கிடைத்ததா?",
        options: ["ஆம்", "பகுதியாக", "இல்லை", "பொருந்தாது"],
      },
      q14: { prompt: "நேரம் அல்லது கிடைக்கும் தன்மை எவ்வளவு வசதியாக இருந்தது?" },
      q15: { prompt: "நீங்கள் பெற்ற மிகப்பெரிய பயன் என்ன?" },
      q16: { prompt: "நீங்கள் பரிந்துரைக்கும் மிகப்பெரிய மேம்பாடு என்ன?" },
      q17: { prompt: "நாங்கள் கேட்காத முக்கியமான ஏதேனும் உள்ளதா?" },
      q18: { prompt: "உங்கள் கருத்து குறித்து யாராவது தொடர்பு கொள்ள வேண்டுமா?" },
      q19: {
        prompt: "தொடர்பு கொள்ள விரும்பும் வழி என்ன?",
        options: ["தொலைபேசி", "மின்னஞ்சல்", "செய்தி", "தொடர் கவனிப்பு வேண்டாம்"],
      },
      q20: { prompt: "உங்கள் கருத்துகளை உள் சுருக்கத்தில் பெயரின்றி மேற்கோள் காட்டலாமா?" },
    },
  ),
  te: pack(
    "te",
    {
      greeting_named: "నమస్కారం, నేను కాల్ ఆంటీ పరిశోధన సహాయకురాలిని. నేను {name}తో మాట్లాడుతున్నానా?",
      greeting_generic: "నమస్కారం. ఒక చిన్న కాల్పనిక సర్వే కోసం కాల్ చేస్తున్నాను. ఇప్పుడు సమయం సరిపోతుందా?",
      consent_prompt:
        "ఇది పరీక్ష కోసం కాల్పనిక సర్వే. ఇప్పుడు చిన్న సర్వేకు సమాధానం చెప్పడానికి మంచి సమయమా, ఈ సర్వే కోసం మీ సమాధానాలను నమోదు చేసుకోవచ్చా?",
      thanks_testing: "ధన్యవాదాలు. ఇది పరీక్ష కోసం కాల్పనిక సర్వే.",
      decline_close: "సమస్య లేదు. నేను సర్వే కొనసాగించను. మీ సమయానికి ధన్యవాదాలు.",
      reschedule_offer: "తప్పకుండా. దీన్ని తిరిగి కాల్ అభ్యర్థనగా గుర్తించవచ్చు. {time} సరిపోతుందా?",
      reschedule_ack: "ఇప్పుడు సర్వే ప్రారంభించను. అభ్యర్థించిన సమయంలో కొనసాగించవచ్చు.",
      skip_no_followup: "అర్థమైంది. ఫాలో-అప్ సంప్రదింపు అడగబడదు.",
      voicemail:
        "నమస్కారం, నేను కాల్ ఆంటీ పరిశోధన సహాయకురాలిని. కాల్పనిక సర్వేలో పాల్గొనాలంటే అధికారిక కాల్‌బ్యాక్ ఛానెల్ ద్వారా తిరిగి కాల్ చేయండి. వీడ్కోలు.",
      complete: "ధన్యవాదాలు, {name}. కాల్పనిక సర్వే ఇక్కడ పూర్తయింది.",
      acknowledge_negative:
        "చెప్పినందుకు ధన్యవాదాలు. సేవను రేట్ చేయమని లేదా సిఫార్సు చేయమని అడగను. చెప్పదలచుకోనిది దాటవేయవచ్చు.",
      offer_skip: "మిగిలిన ఐచ్ఛిక ప్రశ్నలను దాటవేయాలనుకుంటున్నారా?",
      safety_stop_probing:
        "దీనికి వ్యక్తిగత సంరక్షణ అవసరం కావచ్చు. మరింత వివరం అడగను. ఇప్పుడే అత్యవసర వ్యక్తిగత సంరక్షణ తీసుకోండి. ఒక ఆరోగ్య కార్యకర్త ఫాలో-అప్ చేయవచ్చు. మిగిలిన ఐచ్ఛిక ప్రశ్నలను ఆపుతున్నాను.",
      q06_careful: "చెప్పదలిస్తే, ఏదైనా గందరగోళం లేదా ఇబ్బంది ఉందా? దీన్ని దాటవేయవచ్చు.",
      system_reschedule: "స్థితి మార్పు: in_progress -> rescheduled; స్థానిక సమయం {time}కి కాల్‌బ్యాక్ అభ్యర్థన.",
      system_voicemail: "వాయిస్ మెయిల్ కనుగొనబడింది. కాల్‌ను వాయిస్ మెయిల్‌గా గుర్తించి సర్వే ప్రారంభించవద్దు.",
      system_transport: "కనెక్షన్ తెగింది. మళ్లీ ప్రయత్నించే ముందు కర్సర్‌ను {questionId} వద్ద ఉంచండి. సమ్మతి నుండి మళ్లీ మొదలుపెట్టవద్దు.",
      system_safety:
        "స్థితి: కష్టం గుర్తించబడింది. మిగిలిన ఐచ్ఛిక ప్రశ్నలను దాటవేయండి. ఉదహరించదగిన వివరణ కాదు, భద్రతా కోడ్ ఉంచండి. మానవ ఫాలో-అప్‌కు పంపండి.",
    },
    {
      consent: { prompt: "ఇప్పుడు ఒక చిన్న సర్వేకు సమాధానం చెప్పడానికి మంచి సమయమా, ఈ సర్వే కోసం మీ సమాధానాలను నమోదు చేసుకోవచ్చా?" },
      q01: {
        prompt: "సేవతో మీ మొత్తం అనుభవం ఎలా ఉంది?",
        options: ["చాలా సానుకూలం", "కొంత సానుకూలం", "మధ్యస్థం", "కొంత ప్రతికూలం", "చాలా ప్రతికూలం"],
      },
      q02: { prompt: "కావాల్సిన సహాయం లేదా సమాచారం పొందడం ఎంత సులభం?" },
      q03: { prompt: "మీకు వచ్చిన సూచనలు ఎంత స్పష్టంగా ఉన్నాయి?" },
      q04: { prompt: "పట్టిన సమయంతో మీరు ఎంత సంతృప్తిగా ఉన్నారు?" },
      q05: {
        prompt: "అనుభవంలో ఏ భాగాలు మీకు బాగా పనిచేశాయి?",
        options: ["సులభ వినియోగం", "సిబ్బంది సహాయం", "వేగం", "స్పష్టత", "సౌకర్యం", "ఫాలో-అప్"],
      },
      q06: { prompt: "ఏదైనా గందరగోళం లేదా ఇబ్బంది ఉందా?" },
      q07: { prompt: "మీరు చేయదలుచుకున్నది పూర్తి చేయగలిగారా?" },
      q08: { prompt: "ఒక విషయం మార్చగలిగితే, అది ఏమిటి?" },
      q09: { prompt: "సేవను మళ్లీ ఉపయోగించే అవకాశం ఎంత?" },
      q10: { prompt: "తెలిసిన వారికి ఈ సేవను సిఫార్సు చేసే అవకాశం ఎంత?" },
      q11: { prompt: "ప్రశ్నలు అడగడానికి తగిన అవకాశం దొరికిందని అనిపించిందా?" },
      q12: { prompt: "సహాయం చేసిన వ్యక్తి మీ ఆందోళనలు విన్నారా?" },
      q13: {
        prompt: "మీరు ఆశించిన ఫాలో-అప్ అందిందా?",
        options: ["అవును", "పాక్షికం", "కాదు", "వర్తించదు"],
      },
      q14: { prompt: "సమయం లేదా లభ్యత ఎంత సౌకర్యవంతంగా ఉంది?" },
      q15: { prompt: "మీరు పొందిన అతిపెద్ద ప్రయోజనం ఏమిటి?" },
      q16: { prompt: "మీరు సూచించే అతిపెద్ద మెరుగుదల ఏమిటి?" },
      q17: { prompt: "మేము అడగని ముఖ్యమైనది ఏదైనా ఉందా?" },
      q18: { prompt: "మీ అభిప్రాయం గురించి ఎవరైనా సంప్రదించాలనుకుంటున్నారా?" },
      q19: {
        prompt: "సంప్రదించడానికి మీకు ఇష్టమైన మార్గం ఏమిటి?",
        options: ["ఫోన్", "ఇమెయిల్", "సందేశం", "ఫాలో-అప్ వద్దు"],
      },
      q20: { prompt: "అంతర్గత సారాంశంలో మీ వ్యాఖ్యలను పేరు లేకుండా ఉదహరించవచ్చా?" },
    },
  ),
};

export const CALL_SCRIPT_LOCALES = Object.keys(CALL_AUNTY_SCRIPT_PACKS) as AppLanguage[];

export function getCallScriptPack(locale: AppLanguage): CallScriptPack {
  return CALL_AUNTY_SCRIPT_PACKS[locale] ?? CALL_AUNTY_SCRIPT_PACKS.en;
}

export function interpolateScript(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

export function localizeQuestionPrompt(question: SurveyQuestion, locale: AppLanguage): string {
  const copy = getCallScriptPack(locale).questions[question.id];
  const prompt = copy?.prompt ?? question.prompt;
  if (question.type !== "scale" || question.min == null || question.max == null) return prompt;
  if (locale === "en") return `On a scale from ${question.min} to ${question.max}, ${prompt}`;
  if (locale === "bn") return `${question.min} থেকে ${question.max} স্কেলে, ${prompt}`;
  if (locale === "hi") return `${question.min} से ${question.max} के पैमाने पर, ${prompt}`;
  if (locale === "ur") return `${question.min} سے ${question.max} کے پیمانے پر، ${prompt}`;
  if (locale === "ta") return `${question.min} முதல் ${question.max} வரை, ${prompt}`;
  return `${question.min} నుండి ${question.max} స్కేల్‌లో, ${prompt}`;
}

export function canonicalizeOption(question: SurveyQuestion, spoken: string, locale: AppLanguage): string {
  if (!question.options?.length) return spoken;
  const englishIndex = question.options.findIndex((option) => option === spoken);
  if (englishIndex >= 0) return question.options[englishIndex];
  const localized = getCallScriptPack(locale).questions[question.id]?.options ?? [];
  const localizedIndex = localized.findIndex((option) => option === spoken);
  if (localizedIndex >= 0 && question.options[localizedIndex]) return question.options[localizedIndex];
  return spoken;
}

export function localizeTurn(turn: MockTurn, locale: AppLanguage, survey: SurveyQuestion[] = CALL_AUNTY_SURVEY): MockTurn {
  const pack = getCallScriptPack(locale);
  if (turn.scriptKey) {
    return {
      ...turn,
      text: interpolateScript(pack.frames[turn.scriptKey], turn.scriptParams),
    };
  }
  if (turn.speaker === "agent" && turn.questionId) {
    const question = survey.find((item) => item.id === turn.questionId);
    if (question) return { ...turn, text: localizeQuestionPrompt(question, locale) };
  }
  return turn;
}

export function localizeScenario(scenario: MockCallScenario, locale: AppLanguage): MockCallScenario {
  return {
    ...scenario,
    locale,
    transcript: scenario.transcript.map((turn) => localizeTurn(turn, locale, scenario.survey)),
  };
}
