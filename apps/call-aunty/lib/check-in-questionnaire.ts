import type { AppLanguage } from "@/lib/language";
import type { CheckInAnswers } from "@/lib/triage";

export type CheckInQuestionId = keyof CheckInAnswers;

export type CheckInQuestion = {
  id: CheckInQuestionId;
  /** Which tap marks a concerning finding for this prompt. */
  concerningWhen: "yes" | "no";
  /** Immediate escalate vs finish-and-route to CHW. */
  urgency: "urgent" | "attention";
};

/** Canonical maternal check-in pack — kept in lockstep with `CheckInAnswers`. */
export const CHECK_IN_QUESTIONS: readonly CheckInQuestion[] = [
  { id: "severeBleedingOrPain", concerningWhen: "yes", urgency: "urgent" },
  { id: "breathingDifficulty", concerningWhen: "yes", urgency: "urgent" },
  { id: "reducedBabyMovement", concerningWhen: "no", urgency: "attention" },
  { id: "needsHelpScheduling", concerningWhen: "yes", urgency: "attention" },
] as const;

export const CHECK_IN_QUESTION_COUNT = CHECK_IN_QUESTIONS.length;

export const EMPTY_CHECK_IN_ANSWERS: CheckInAnswers = {
  severeBleedingOrPain: false,
  breathingDifficulty: false,
  reducedBabyMovement: false,
  needsHelpScheduling: false,
};

export type CheckInQuestionnaireCopy = {
  questions: Record<CheckInQuestionId, string>;
  hints: Record<CheckInQuestionId, string>;
  findings: Record<CheckInQuestionId, string>;
  imageAlt: Record<CheckInQuestionId, string>;
  symptomYes: string;
  symptomNo: string;
  movementYes: string;
  movementNo: string;
  schedulingYes: string;
  schedulingNo: string;
  findingsTitle: string;
  attentionTitle: string;
  attentionBody: string;
  contactChwToday: string;
  savedOnDevice: string;
  previousQuestion: string;
  startNew: string;
  restartTitle: string;
  restartBody: string;
  pauseToast: string;
  seeCarePlan: string;
  progress: (current: number, total: number) => string;
};

const english: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "Do you have heavy bleeding or severe pain right now?",
    breathingDifficulty: "Are you having trouble breathing right now?",
    reducedBabyMovement: "Since your last check-in, have you felt the baby move as usual?",
    needsHelpScheduling: "Do you need help arranging a care visit or follow-up?",
  },
  hints: {
    severeBleedingOrPain: "Heavy bleeding soaks through cloth quickly, or pain that makes it hard to walk or rest.",
    breathingDifficulty: "Hard to speak a full sentence, or breathing that feels suddenly worse.",
    reducedBabyMovement: "Think about the baby’s usual pattern for you — less movement than that counts.",
    needsHelpScheduling: "Say yes if a visit is due and you cannot arrange transport, time, or who to call.",
  },
  findings: {
    severeBleedingOrPain: "Heavy bleeding or severe pain",
    breathingDifficulty: "Trouble breathing",
    reducedBabyMovement: "Less baby movement than usual",
    needsHelpScheduling: "Needs help arranging care",
  },
  imageAlt: {
    severeBleedingOrPain: "Illustration of a pregnant woman resting a hand on her belly, checking for pain or bleeding.",
    breathingDifficulty: "Illustration of a pregnant woman taking a calm breath outdoors.",
    reducedBabyMovement: "Illustration of a pregnant woman feeling the baby move.",
    needsHelpScheduling: "Illustration of a pregnant woman walking to a community clinic for care.",
  },
  symptomYes: "Yes, right now",
  symptomNo: "No",
  movementYes: "Yes, as usual",
  movementNo: "No, less than usual",
  schedulingYes: "Yes — I need help",
  schedulingNo: "No, I’m fine for now",
  findingsTitle: "Based on your answers",
  attentionTitle: "Please contact your health worker today",
  attentionBody:
    "Your answers suggest a change that should be reviewed today. Call your health worker, or ask Aunty to help you connect. This is not an emergency screen — if symptoms worsen, seek care right away.",
  contactChwToday: "Contact my health worker",
  savedOnDevice: "Saved on this phone",
  previousQuestion: "Previous question",
  startNew: "Start a new check-in",
  restartTitle: "Start a new check-in?",
  restartBody: "Your unfinished answers are still on this phone. Resume to keep them, or start over.",
  pauseToast: "Progress saved on this phone",
  seeCarePlan: "See my care plan",
  progress: (current, total) => `${current} of ${total}`,
};

const bangla: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "এখন কি আপনার ভারী রক্তপাত বা তীব্র ব্যথা আছে?",
    breathingDifficulty: "এখন কি আপনার শ্বাস নিতে কষ্ট হচ্ছে?",
    reducedBabyMovement: "শেষ চেক-ইনের পর থেকে কি শিশু স্বাভাবিকভাবে নড়াচড়া করেছে?",
    needsHelpScheduling: "যত্নের ভিজিট বা ফলো-আপ সাজাতে কি আপনার সাহায্য দরকার?",
  },
  hints: {
    severeBleedingOrPain: "কাপড় দ্রুত ভিজে যায় এমন রক্তপাত, বা হাঁটা/বিশ্রামে বাধা দেয় এমন ব্যথা।",
    breathingDifficulty: "এক বাক্য বলে শেষ করা কঠিন, বা শ্বাস হঠাৎ খারাপ লাগা।",
    reducedBabyMovement: "আপনার শিশুর স্বাভাবিক ছন্দ ভাবুন — তার চেয়ে কম নড়াচড়া হলে বলুন।",
    needsHelpScheduling: "ভিজিট বাকি থাকলে এবং যাতায়াত, সময় বা কাকে কল করবেন ঠিক করতে না পারলে হ্যাঁ বলুন।",
  },
  findings: {
    severeBleedingOrPain: "ভারী রক্তপাত বা তীব্র ব্যথা",
    breathingDifficulty: "শ্বাসকষ্ট",
    reducedBabyMovement: "স্বাভাবিকের চেয়ে কম নড়াচড়া",
    needsHelpScheduling: "যত্ন সাজাতে সাহায্য দরকার",
  },
  imageAlt: {
    severeBleedingOrPain: "গর্ভবতী নারী পেটে হাত রেখে ব্যথা বা রক্তপাত পরীক্ষা করছেন — চিত্রণ।",
    breathingDifficulty: "গর্ভবতী নারী বাইরে শান্তভাবে শ্বাস নিচ্ছেন — চিত্রণ।",
    reducedBabyMovement: "গর্ভবতী নারী শিশুর নড়াচড়া অনুভব করছেন — চিত্রণ।",
    needsHelpScheduling: "গর্ভবতী নারী কমিউনিটি ক্লিনিকের দিকে যাচ্ছেন — চিত্রণ।",
  },
  symptomYes: "হ্যাঁ, এখনই",
  symptomNo: "না",
  movementYes: "হ্যাঁ, স্বাভাবিকভাবে",
  movementNo: "না, স্বাভাবিকের চেয়ে কম",
  schedulingYes: "হ্যাঁ — আমার সাহায্য দরকার",
  schedulingNo: "না, এখন ঠিক আছি",
  findingsTitle: "আপনার উত্তর অনুযায়ী",
  attentionTitle: "আজই আপনার স্বাস্থ্যকর্মীকে যোগাযোগ করুন",
  attentionBody:
    "আপনার উত্তরগুলো এমন পরিবর্তন দেখায় যা আজ পর্যালোচনা করা উচিত। স্বাস্থ্যকর্মীকে কল করুন, অথবা সংযোগে সাহায্যের জন্য আন্টিকে বলুন। এটি জরুরি স্ক্রিন নয় — লক্ষণ খারাপ হলে এখনই যত্ন নিন।",
  contactChwToday: "আমার স্বাস্থ্যকর্মীকে যোগাযোগ করুন",
  savedOnDevice: "এই ফোনে সংরক্ষিত",
  previousQuestion: "আগের প্রশ্ন",
  startNew: "নতুন চেক-ইন শুরু করুন",
  restartTitle: "নতুন করে শুরু করবেন?",
  restartBody: "আপনার অসম্পূর্ণ উত্তর এই ফোনে আছে। রাখতে চালিয়ে যান, অথবা নতুন করে শুরু করুন।",
  pauseToast: "অগ্রগতি এই ফোনে সংরক্ষিত",
  seeCarePlan: "আমার যত্নের পরিকল্পনা দেখুন",
  progress: (current, total) => `${total}টির মধ্যে ${current}`,
};

const hindi: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "क्या अभी आपको भारी रक्तस्राव या तेज़ दर्द है?",
    breathingDifficulty: "क्या आपको अभी साँस लेने में तकलीफ़ हो रही है?",
    reducedBabyMovement: "पिछले चेक-इन के बाद क्या बच्चे की हलचल सामान्य रही?",
    needsHelpScheduling: "क्या आपको देखभाल विज़िट या फॉलो-अप तय करने में मदद चाहिए?",
  },
  hints: {
    severeBleedingOrPain: "तेज़ी से कपड़ा गीला करने वाला रक्तस्राव, या दर्द जिससे चलना/आराम मुश्किल हो।",
    breathingDifficulty: "पूरा वाक्य बोलना कठिन, या साँस अचानक बिगड़ना।",
    reducedBabyMovement: "बच्चे की सामान्य लय सोचें — उससे कम हलचल हो तो बताएँ।",
    needsHelpScheduling: "विज़िट बाकी हो और आना-जाना, समय या किसे कॉल करें तय न हो तो हाँ कहें।",
  },
  findings: {
    severeBleedingOrPain: "भारी रक्तस्राव या तेज़ दर्द",
    breathingDifficulty: "साँस लेने में तकलीफ़",
    reducedBabyMovement: "सामान्य से कम हलचल",
    needsHelpScheduling: "देखभाल तय करने में मदद चाहिए",
  },
  imageAlt: {
    severeBleedingOrPain: "गर्भवती महिला पेट पर हाथ रखकर दर्द या रक्तस्राव जाँच रही हैं — चित्र।",
    breathingDifficulty: "गर्भवती महिला बाहर शांत साँस ले रही हैं — चित्र।",
    reducedBabyMovement: "गर्भवती महिला बच्चे की हलचल महसूस कर रही हैं — चित्र।",
    needsHelpScheduling: "गर्भवती महिला सामुदायिक क्लिनिक की ओर जा रही हैं — चित्र।",
  },
  symptomYes: "हाँ, अभी",
  symptomNo: "नहीं",
  movementYes: "हाँ, सामान्य रही",
  movementNo: "नहीं, सामान्य से कम",
  schedulingYes: "हाँ — मुझे मदद चाहिए",
  schedulingNo: "नहीं, अभी ठीक हूँ",
  findingsTitle: "आपके उत्तरों के आधार पर",
  attentionTitle: "आज अपने स्वास्थ्यकर्मी से संपर्क करें",
  attentionBody:
    "आपके उत्तरों से ऐसा बदलाव दिखता है जिसकी आज समीक्षा होनी चाहिए। अपने स्वास्थ्यकर्मी को कॉल करें, या जुड़ने में मदद के लिए आंटी से कहें। यह आपात स्क्रीन नहीं है — लक्षण बिगड़ें तो तुरंत देखभाल लें।",
  contactChwToday: "मेरे स्वास्थ्यकर्मी से संपर्क करें",
  savedOnDevice: "इस फ़ोन पर सहेजा गया",
  previousQuestion: "पिछला प्रश्न",
  startNew: "नया चेक-इन शुरू करें",
  restartTitle: "नया चेक-इन शुरू करें?",
  restartBody: "आपके अधूरे उत्तर इस फ़ोन पर हैं। रखने के लिए जारी रखें, या फिर से शुरू करें।",
  pauseToast: "प्रगति इस फ़ोन पर सहेजी गई",
  seeCarePlan: "मेरी देखभाल योजना देखें",
  progress: (current, total) => `${total} में से ${current}`,
};

const urdu: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "کیا ابھی آپ کو شدید خون بہنا یا شدید درد ہے؟",
    breathingDifficulty: "کیا آپ کو ابھی سانس لینے میں مشکل ہو رہی ہے؟",
    reducedBabyMovement: "آخری چیک اِن کے بعد کیا بچے کی حرکت معمول کے مطابق رہی؟",
    needsHelpScheduling: "کیا آپ کو دیکھ بھال کی ملاقات یا فالو اَپ ترتیب دینے میں مدد چاہیے؟",
  },
  hints: {
    severeBleedingOrPain: "کپڑا تیزی سے گیلا کرنے والا خون بہنا، یا درد جس سے چلنا/آرام مشکل ہو۔",
    breathingDifficulty: "پورا جملہ بولنا مشکل، یا سانس اچانک خراب ہونا۔",
    reducedBabyMovement: "بچے کی معمول کی رفتار سوچیں — اس سے کم حرکت ہو تو بتائیں۔",
    needsHelpScheduling: "ملاقات باقی ہو اور آمدورفت، وقت یا کسے کال کریں طے نہ ہو تو ہاں کہیں۔",
  },
  findings: {
    severeBleedingOrPain: "شدید خون بہنا یا شدید درد",
    breathingDifficulty: "سانس لینے میں مشکل",
    reducedBabyMovement: "معمول سے کم حرکت",
    needsHelpScheduling: "دیکھ بھال ترتیب دینے میں مدد چاہیے",
  },
  imageAlt: {
    severeBleedingOrPain: "حاملہ خاتون پیٹ پر ہاتھ رکھ کر درد یا خون بہنے کی جانچ کر رہی ہیں — تصویر۔",
    breathingDifficulty: "حاملہ خاتون باہر پرسکون سانس لے رہی ہیں — تصویر۔",
    reducedBabyMovement: "حاملہ خاتون بچے کی حرکت محسوس کر رہی ہیں — تصویر۔",
    needsHelpScheduling: "حاملہ خاتون کمیونٹی کلینک کی طرف جا رہی ہیں — تصویر۔",
  },
  symptomYes: "ہاں، ابھی",
  symptomNo: "نہیں",
  movementYes: "ہاں، معمول کے مطابق",
  movementNo: "نہیں، معمول سے کم",
  schedulingYes: "ہاں — مجھے مدد چاہیے",
  schedulingNo: "نہیں، ابھی ٹھیک ہوں",
  findingsTitle: "آپ کے جوابات کی بنیاد پر",
  attentionTitle: "آج اپنے صحت کارکن سے رابطہ کریں",
  attentionBody:
    "آپ کے جوابات ایسی تبدیلی ظاہر کرتے ہیں جس کا آج جائزہ لینا چاہیے۔ اپنے صحت کارکن کو کال کریں، یا رابطے میں مدد کے لیے آنٹی سے کہیں۔ یہ ہنگامی اسکرین نہیں — علامات بگڑیں تو فوراً دیکھ بھال لیں۔",
  contactChwToday: "میرے صحت کارکن سے رابطہ کریں",
  savedOnDevice: "اس فون پر محفوظ",
  previousQuestion: "پچھلا سوال",
  startNew: "نیا چیک اِن شروع کریں",
  restartTitle: "نیا چیک اِن شروع کریں؟",
  restartBody: "آپ کے ادھورے جوابات اس فون پر ہیں۔ رکھنے کے لیے جاری رکھیں، یا نئے سرے سے شروع کریں۔",
  pauseToast: "پیش رفت اس فون پر محفوظ ہو گئی",
  seeCarePlan: "میرا دیکھ بھال کا منصوبہ دیکھیں",
  progress: (current, total) => `${total} میں سے ${current}`,
};

const tamil: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "இப்போது உங்களுக்கு அதிக இரத்தப்போக்கு அல்லது கடுமையான வலி உள்ளதா?",
    breathingDifficulty: "இப்போது உங்களுக்கு மூச்சு விட சிரமம் இருக்கிறதா?",
    reducedBabyMovement: "கடந்த செக்-இனுக்குப் பிறகு குழந்தை வழக்கம்போல் அசைந்ததா?",
    needsHelpScheduling: "பராமரிப்பு வருகை அல்லது பின்தொடர்வை ஏற்பாடு செய்ய உதவி தேவையா?",
  },
  hints: {
    severeBleedingOrPain: "துணியை விரைவில் நனைக்கும் இரத்தப்போக்கு, அல்லது நடக்க/ஓய்வெடுக்க தடையாகும் வலி.",
    breathingDifficulty: "முழு வாக்கியம் பேசுவது கடினம், அல்லது மூச்சு திடீரென மோசமாவது.",
    reducedBabyMovement: "குழந்தையின் வழக்கமான தாளத்தை நினைவுகூருங்கள் — அதை விட குறைவு என்றால் சொல்லுங்கள்.",
    needsHelpScheduling: "வருகை நிலுவையில் இருந்து பயணம், நேரம் அல்லது யாரை அழைப்பது தெரியவில்லையெனில் ஆம் எனச் சொல்லுங்கள்.",
  },
  findings: {
    severeBleedingOrPain: "அதிக இரத்தப்போக்கு அல்லது கடுமையான வலி",
    breathingDifficulty: "மூச்சு சிரமம்",
    reducedBabyMovement: "வழக்கத்தை விட குறைவான அசைவு",
    needsHelpScheduling: "பராமரிப்பு ஏற்பாட்டில் உதவி தேவை",
  },
  imageAlt: {
    severeBleedingOrPain: "கர்ப்பிணி பெண் வயிற்றில் கை வைத்து வலி அல்லது இரத்தப்போக்கைப் பார்க்கும் படம்.",
    breathingDifficulty: "கர்ப்பிணி பெண் வெளியே அமைதியாக மூச்சு விடும் படம்.",
    reducedBabyMovement: "கர்ப்பிணி பெண் குழந்தையின் அசைவை உணரும் படம்.",
    needsHelpScheduling: "கர்ப்பிணி பெண் சமூக கிளினிக்கை நோக்கிச் செல்லும் படம்.",
  },
  symptomYes: "ஆம், இப்போது",
  symptomNo: "இல்லை",
  movementYes: "ஆம், வழக்கம்போல்",
  movementNo: "இல்லை, வழக்கத்தை விட குறைவு",
  schedulingYes: "ஆம் — எனக்கு உதவி வேண்டும்",
  schedulingNo: "இல்லை, இப்போது சரி",
  findingsTitle: "உங்கள் பதில்களின் அடிப்படையில்",
  attentionTitle: "இன்றே உங்கள் சுகாதாரப் பணியாளரை தொடர்பு கொள்ளுங்கள்",
  attentionBody:
    "உங்கள் பதில்கள் இன்று மதிப்பாய்வு செய்ய வேண்டிய மாற்றத்தைக் காட்டுகின்றன. உங்கள் சுகாதாரப் பணியாளரை அழைக்கவும், அல்லது இணைக்க ஆண்டியிடம் உதவி கேளுங்கள். இது அவசரத் திரை அல்ல — அறிகுறிகள் மோசமானால் உடனே பராமரிப்பு பெறுங்கள்.",
  contactChwToday: "என் சுகாதாரப் பணியாளரை தொடர்பு கொள்ளுங்கள்",
  savedOnDevice: "இந்த தொலைபேசியில் சேமிக்கப்பட்டது",
  previousQuestion: "முந்தைய கேள்வி",
  startNew: "புதிய செக்-இன் தொடங்கவும்",
  restartTitle: "புதிய செக்-இன் தொடங்கவா?",
  restartBody: "உங்கள் முடிக்காத பதில்கள் இந்த தொலைபேசியில் உள்ளன. வைத்திருக்க தொடரவும், அல்லது மீண்டும் தொடங்கவும்.",
  pauseToast: "முன்னேற்றம் இந்த தொலைபேசியில் சேமிக்கப்பட்டது",
  seeCarePlan: "என் பராமரிப்பு திட்டத்தைப் பார்க்கவும்",
  progress: (current, total) => `${total} இல் ${current}`,
};

const telugu: CheckInQuestionnaireCopy = {
  questions: {
    severeBleedingOrPain: "ఇప్పుడు మీకు ఎక్కువ రక్తస్రావం లేదా తీవ్రమైన నొప్పి ఉందా?",
    breathingDifficulty: "ఇప్పుడు మీకు ఊపిరి తీసుకోవడంలో ఇబ్బంది ఉందా?",
    reducedBabyMovement: "మునుపటి చెక్-ఇన్ తర్వాత శిశువు సాధారణంగా కదిలిందా?",
    needsHelpScheduling: "సంరక్షణ సందర్శన లేదా ఫాలో-అప్ ఏర్పాటు చేయడానికి సహాయం కావాలా?",
  },
  hints: {
    severeBleedingOrPain: "వస్త్రం త్వరగా తడిపే రక్తస్రావం, లేదా నడక/విశ్రాంతికి అడ్డుపడే నొప్పి.",
    breathingDifficulty: "పూర్తి వాక్యం చెప్పడం కష్టం, లేదా ఊపిరి అకస్మాత్తుగా అధ్వాన్నం కావడం.",
    reducedBabyMovement: "శిశువు సాధారణ లయను గుర్తుంచుకోండి — అంతకంటే తక్కువ కదలిక అయితే చెప్పండి.",
    needsHelpScheduling: "సందర్శన మిగిలి ఉండి ప్రయాణం, సమయం లేదా ఎవరికి కాల్ చేయాలో తెలియకుంటే అవును అనండి.",
  },
  findings: {
    severeBleedingOrPain: "ఎక్కువ రక్తస్రావం లేదా తీవ్రమైన నొప్పి",
    breathingDifficulty: "ఊపిరి ఇబ్బంది",
    reducedBabyMovement: "సాధారణం కంటే తక్కువ కదలిక",
    needsHelpScheduling: "సంరక్షణ ఏర్పాటులో సహాయం కావాలి",
  },
  imageAlt: {
    severeBleedingOrPain: "గర్భిణి స్త్రీ కడుపుపై చేయి ఉంచి నొప్పి లేదా రక్తస్రావం చూసుకుంటున్న చిత్రం.",
    breathingDifficulty: "గర్భిణి స్త్రీ బయట ప్రశాంతంగా ఊపిరి తీసుకుంటున్న చిత్రం.",
    reducedBabyMovement: "గర్భిణి స్త్రీ శిశువు కదలికను అనుభవిస్తున్న చిత్రం.",
    needsHelpScheduling: "గర్భిణి స్త్రీ కమ్యూనిటీ క్లినిక్ వైపు వెళ్తున్న చిత్రం.",
  },
  symptomYes: "అవును, ఇప్పుడే",
  symptomNo: "కాదు",
  movementYes: "అవును, సాధారణంగా",
  movementNo: "కాదు, సాధారణం కంటే తక్కువ",
  schedulingYes: "అవును — నాకు సహాయం కావాలి",
  schedulingNo: "కాదు, ఇప్పుడు బాగానే ఉన్నాను",
  findingsTitle: "మీ సమాధానాల ఆధారంగా",
  attentionTitle: "ఈరోజే మీ ఆరోగ్య కార్యకర్తను సంప్రదించండి",
  attentionBody:
    "మీ సమాధానాలు ఈరోజు సమీక్షించాల్సిన మార్పును చూపుతున్నాయి. మీ ఆరోగ్య కార్యకర్తను కాల్ చేయండి, లేదా కనెక్ట్ కావడానికి ఆంటీ సహాయం అడగండి. ఇది అత్యవసర స్క్రీన్ కాదు — లక్షణాలు అధ్వాన్నంగా ఉంటే వెంటనే సంరక్షణ పొందండి.",
  contactChwToday: "నా ఆరోగ్య కార్యకర్తను సంప్రదించండి",
  savedOnDevice: "ఈ ఫోన్‌లో సేవ్ అయింది",
  previousQuestion: "మునుపటి ప్రశ్న",
  startNew: "కొత్త చెక్-ఇన్ ప్రారంభించండి",
  restartTitle: "కొత్త చెక్-ఇన్ ప్రారంభించాలా?",
  restartBody: "మీ అసంపూర్ణ సమాధానాలు ఈ ఫోన్‌లో ఉన్నాయి. ఉంచడానికి కొనసాగించండి, లేదా మళ్లీ ప్రారంభించండి.",
  pauseToast: "పురోగతి ఈ ఫోన్‌లో సేవ్ అయింది",
  seeCarePlan: "నా సంరక్షణ ప్రణాళిక చూడండి",
  progress: (current, total) => `${total}లో ${current}`,
};

const copyByLanguage: Record<AppLanguage, CheckInQuestionnaireCopy> = {
  en: english,
  bn: bangla,
  hi: hindi,
  ur: urdu,
  ta: tamil,
  te: telugu,
};

export function getCheckInQuestionnaireCopy(language: AppLanguage): CheckInQuestionnaireCopy {
  return copyByLanguage[language] ?? english;
}

export function getAnswerLabels(
  question: CheckInQuestion,
  copy: CheckInQuestionnaireCopy,
): { yesLabel: string; noLabel: string } {
  if (question.id === "reducedBabyMovement") {
    return { yesLabel: copy.movementYes, noLabel: copy.movementNo };
  }
  if (question.id === "needsHelpScheduling") {
    return { yesLabel: copy.schedulingYes, noLabel: copy.schedulingNo };
  }
  return { yesLabel: copy.symptomYes, noLabel: copy.symptomNo };
}

export function isConcerningAnswer(question: CheckInQuestion, choseYes: boolean): boolean {
  return question.concerningWhen === "yes" ? choseYes : !choseYes;
}
