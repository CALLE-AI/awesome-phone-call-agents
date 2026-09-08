// The phone interview: task text per language and matter type, plus the structured result CALL-E must return.
import { matter } from "./_matters.js";

// Fields every intake returns, whatever the matter type.
const BASE_FIELDS = {
  full_name: { type: "string" },
  email: { type: "string", description: "Email address as the caller spelled it, or 'none'" },
  preferred_language: { type: "string" },
  matter_summary: { type: "string", description: "2-3 sentence summary in English" },
  other_parties: { type: "string", description: "Other people or companies involved, for the conflict check, or 'none'" },
  urgency: { type: "string", enum: ["low", "normal", "high"] },
  deadline_or_court_date: { type: "string", description: "Any date mentioned, verbatim, or 'none'" },
  best_time_to_call: { type: "string" },
  consent_to_contact: { type: "string", enum: ["yes", "no", "unknown"] },
};
export const BASE_FIELD_NAMES = Object.keys(BASE_FIELDS);

export function resultSchema(matterType) {
  const m = matter(matterType);
  return {
    type: "object",
    required: ["full_name", "matter_summary", "urgency", "consent_to_contact"],
    properties: { ...BASE_FIELDS, ...m.fields },
  };
}
// Kept for callers that predate matter types.
export const RESULT_SCHEMA = resultSchema("other");

const PREAMBLE = {
  en: `You are the intake assistant for {firm}, a law firm. You are calling {name}, who just asked for a consultation about {matter} through the website. Open by confirming you are speaking with {name}, then say clearly: this is an intake call to gather information, it is not legal advice, and no attorney-client relationship exists until an attorney confirms in writing.`,
  es: `Eres la asistente de admisión de {firm}, un despacho de abogados. Estás llamando a {name}, quien acaba de solicitar una consulta sobre {matter} por el sitio web. Empieza confirmando que hablas con {name}; luego di claramente: esta es una llamada de admisión para recopilar información, no es asesoría legal, y no existe relación abogado-cliente hasta que un abogado lo confirme por escrito.`,
  id: `Lakukan seluruh panggilan ini dalam Bahasa Indonesia. Anda adalah asisten penerimaan (intake) untuk {firm}, sebuah firma hukum. Anda menelepon {name}, yang baru saja meminta konsultasi tentang {matter} melalui situs web. Mulailah dengan memastikan Anda berbicara dengan {name}; lalu sampaikan dengan jelas: ini adalah panggilan penerimaan untuk mengumpulkan informasi, bukan nasihat hukum, dan belum ada hubungan pengacara-klien sampai seorang pengacara mengonfirmasinya secara tertulis.`,
};

const COMMON = {
  en: `Immediately after that, without pausing or waiting, ask the first question. Conversationally, learn: (1) confirm the spelling of their name only if it is unusual; (2) what they need help with, in their own words — ask one follow-up if unclear; (3) the names of any other people or companies involved, which the firm needs for a conflict check; (4) whether anything has a deadline coming up, and when; (5) how urgent this feels to them; (6) the best day and time to reach them — if the time could be morning or evening, ask which; (7) their email address, read back letter by letter{emailKnown}; (8) whether they consent to the firm contacting them by phone and email.`,
  es: `Inmediatamente después, sin pausas ni esperas, haz la primera pregunta. De forma conversacional, averigua: (1) confirma la ortografía de su nombre solo si es poco común; (2) en qué necesita ayuda, en sus propias palabras — haz una pregunta de seguimiento si no queda claro; (3) los nombres de otras personas o empresas involucradas, que el despacho necesita para verificar conflictos de interés; (4) si hay algún plazo próximo, y cuándo; (5) qué tan urgente le parece; (6) el mejor día y hora para localizarle — si la hora podría ser de mañana o de noche, pregunta cuál; (7) su correo electrónico, repetido letra por letra{emailKnown}; (8) si da su consentimiento para que el despacho le contacte por teléfono y correo electrónico.`,
  id: `Segera setelah itu, tanpa jeda atau menunggu, ajukan pertanyaan pertama. Secara percakapan, cari tahu: (1) pastikan ejaan namanya hanya jika tidak umum; (2) bantuan apa yang ia butuhkan, dengan kata-katanya sendiri — ajukan satu pertanyaan lanjutan jika belum jelas; (3) nama orang atau perusahaan lain yang terlibat, yang dibutuhkan firma untuk pemeriksaan benturan kepentingan; (4) apakah ada tenggat waktu yang akan datang, dan kapan; (5) seberapa mendesak menurutnya; (6) hari dan jam terbaik untuk menghubunginya — jika waktunya bisa pagi atau malam, tanyakan yang mana; (7) alamat emailnya, dibacakan kembali huruf demi huruf{emailKnown}; (8) apakah ia setuju firma menghubunginya lewat telepon dan email.`,
};

const RULES = {
  en: `Do not quote fees, do not give legal advice, do not promise outcomes, do not ask about health or the value of assets. If they ask a legal question, say an attorney will address it in the consultation. Keep the call under five minutes. Close by saying an attorney will review and the firm will follow up.`,
  es: `No menciones honorarios, no des asesoría legal, no prometas resultados, no preguntes por temas de salud ni por el valor de bienes. Si hace una pregunta legal, di que un abogado la responderá en la consulta. Mantén la llamada por debajo de cinco minutos. Cierra diciendo que un abogado revisará la información y el despacho se comunicará.`,
  id: `Jangan menyebutkan biaya, jangan memberi nasihat hukum, jangan menjanjikan hasil, jangan menanyakan kesehatan atau nilai aset. Jika ia mengajukan pertanyaan hukum, katakan seorang pengacara akan menjawabnya saat konsultasi. Jaga agar panggilan kurang dari lima menit. Tutup dengan mengatakan seorang pengacara akan meninjau informasinya dan firma akan menghubungi kembali.`,
};

const EMAIL_KNOWN = {
  en: (e) => ` — the form has ${e}; just confirm it is correct`,
  es: (e) => ` — en el formulario dio ${e}; solo confirma que es correcto`,
  id: (e) => ` — di formulir tertulis ${e}; cukup pastikan itu benar`,
};
const HINT = {
  en: (m) => ` On the form they wrote: "${m}".`,
  es: (m) => ` En el formulario escribió: "${m}".`,
  id: (m) => ` Di formulir ia menulis: "${m}".`,
};

// The brand "Nota.Lawyer" is pronounced "Not a Lawyer". TTS would read it as "Nota dot Lawyer",
// so the script always speaks the firm name in its pronounceable form.
const SPOKEN_NAMES = { "nota.lawyer": "Not a Lawyer" };
const spoken = (firm) => {
  const f = String(firm || "the firm").trim();
  return SPOKEN_NAMES[f.toLowerCase()] || f.replace(/\./g, " ").replace(/\s+/g, " ").trim();
};

// Interview script language from a CALL-E locale code (en-US, es, id, …).
export function scriptLang(locale) {
  const base = String(locale || "en").toLowerCase().split("-")[0];
  return PREAMBLE[base] ? base : "en";
}

export function intakeTask({ lang, firm, name, matterType, matterHint, email }) {
  const l = PREAMBLE[lang] ? lang : "en";
  const m = matter(matterType);
  const hint = matterHint ? HINT[l](matterHint) : "";
  const emailKnown = email ? EMAIL_KNOWN[l](email) : "";
  const typeQ = m.questions[l] ? " " + m.questions[l] : "";
  return PREAMBLE[l].replace(/{firm}/g, spoken(firm)).replace(/{name}/g, name).replace(/{matter}/g, m.label[l].toLowerCase())
       + hint + " " + COMMON[l].replace("{emailKnown}", emailKnown) + typeQ + " " + RULES[l];
}

const REMINDER = {
  en: (firm, name, when) => `You are the assistant for ${firm}. Call ${name} to remind them of their consultation with an attorney on ${when}. Confirm whether they can make it; if not, ask what day and time works instead. Be brief and warm. Do not give legal advice.`,
  es: (firm, name, when) => `Eres la asistente de ${firm}. Llama a ${name} para recordarle su consulta con un abogado el ${when}. Confirma si podrá asistir; si no, pregunta qué día y hora le conviene. Sé breve y amable. No des asesoría legal.`,
  id: (firm, name, when) => `Lakukan panggilan ini dalam Bahasa Indonesia. Anda adalah asisten ${firm}. Telepon ${name} untuk mengingatkan konsultasinya dengan pengacara pada ${when}. Pastikan apakah ia bisa hadir; jika tidak, tanyakan hari dan jam yang cocok. Singkat dan ramah. Jangan memberi nasihat hukum.`,
};

export function reminderTask({ lang, firm, name, when }) {
  return REMINDER[REMINDER[lang] ? lang : "en"](spoken(firm), name, when);
}

export const REMINDER_SCHEMA = {
  type: "object",
  required: ["confirmed"],
  properties: {
    confirmed: { type: "string", enum: ["yes", "no", "unknown"] },
    reschedule_request: { type: "string" },
  },
};
