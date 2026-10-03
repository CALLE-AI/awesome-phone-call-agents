"use client";

import { useMemo, useState } from "react";
import styles from "./demo.module.css";

type Language = "en" | "ar";
type Stage = "source" | "review" | "result";
type Localized = { en: string; ar: string };
type DemoService = {
  id: string;
  icon: string;
  name: Localized;
  short: Localized;
  task: Localized;
  recipient: Localized;
  objective: Localized;
  context: Array<{ label: Localized; value: Localized }>;
  result: Array<{ label: Localized; value: Localized }>;
  transcript: Array<{ speaker: "assistant" | "recipient"; text: Localized }>;
  writeback: Localized;
};

const services: DemoService[] = [
  {
    id: "approval",
    icon: "01",
    name: { en: "Approval & payment follow-up", ar: "متابعة الموافقة والدفع" },
    short: { en: "Client follow-up", ar: "متابعة العميل" },
    task: { en: "DEMO-104 · HVAC drawings and milestone invoice", ar: "DEMO-104 · مخططات التكييف ودفعة المرحلة" },
    recipient: { en: "Samir A. · Client representative", ar: "سمير أ. · ممثل العميل" },
    objective: { en: "Confirm drawing approval, payment timing, and any blocker.", ar: "تأكيد اعتماد المخططات وموعد السداد وأي عائق." },
    context: [
      { label: { en: "Task status", ar: "حالة المهمة" }, value: { en: "Waiting for client", ar: "بانتظار العميل" } },
      { label: { en: "Priority", ar: "الأولوية" }, value: { en: "High", ar: "عالية" } },
      { label: { en: "Due date", ar: "تاريخ الاستحقاق" }, value: { en: "16 Sep 2026", ar: "16 سبتمبر 2026" } },
      { label: { en: "Phone", ar: "الهاتف" }, value: { en: "+966 5X XXX 0142", ar: "+966 5X XXX 0142" } },
    ],
    result: [
      { label: { en: "Approval", ar: "الموافقة" }, value: { en: "Approved", ar: "تمت الموافقة" } },
      { label: { en: "Payment", ar: "الدفع" }, value: { en: "Scheduled", ar: "مجدول" } },
      { label: { en: "Expected date", ar: "التاريخ المتوقع" }, value: { en: "17 Sep 2026", ar: "17 سبتمبر 2026" } },
      { label: { en: "Follow-up", ar: "المتابعة" }, value: { en: "Not required", ar: "غير مطلوبة" } },
    ],
    transcript: [
      { speaker: "assistant", text: { en: "I am calling to confirm the HVAC drawing approval and current payment timing.", ar: "أتواصل لتأكيد اعتماد مخططات التكييف وموعد السداد الحالي." } },
      { speaker: "recipient", text: { en: "The drawings are approved. Finance scheduled the payment for Thursday.", ar: "تم اعتماد المخططات، وحدد قسم المالية السداد يوم الخميس." } },
      { speaker: "assistant", text: { en: "Thank you. I will record the approval and the expected payment date.", ar: "شكراً لك. سأوثق الموافقة وتاريخ السداد المتوقع." } },
    ],
    writeback: { en: "Prepared a concise task comment with the approval and payment date.", ar: "تم تجهيز تعليق مختصر للمهمة يتضمن الموافقة وتاريخ السداد." },
  },
  {
    id: "meeting",
    icon: "02",
    name: { en: "Meeting scheduling", ar: "تنسيق الاجتماعات" },
    short: { en: "Availability check", ar: "التحقق من التوفر" },
    task: { en: "DEMO-208 · Design coordination meeting", ar: "DEMO-208 · اجتماع تنسيق التصميم" },
    recipient: { en: "Rana M. · Project stakeholder", ar: "رنا م. · طرف في المشروع" },
    objective: { en: "Ask for a preferred time, validate availability, and confirm only a free slot.", ar: "طلب الوقت المفضل والتحقق من التوفر وتأكيد الموعد المتاح فقط." },
    context: [
      { label: { en: "Request status", ar: "حالة الطلب" }, value: { en: "Not scheduled", ar: "غير مجدول" } },
      { label: { en: "Attendees", ar: "الحضور" }, value: { en: "Design lead, project manager", ar: "مدير التصميم، مدير المشروع" } },
      { label: { en: "Working hours", ar: "ساعات العمل" }, value: { en: "Sun–Thu · 10:00–17:00", ar: "الأحد–الخميس · 10:00–17:00" } },
      { label: { en: "Phone", ar: "الهاتف" }, value: { en: "+966 5X XXX 0268", ar: "+966 5X XXX 0268" } },
    ],
    result: [
      { label: { en: "Outcome", ar: "النتيجة" }, value: { en: "Available slot selected", ar: "تم اختيار وقت متاح" } },
      { label: { en: "Date", ar: "التاريخ" }, value: { en: "20 Sep 2026", ar: "20 سبتمبر 2026" } },
      { label: { en: "Time", ar: "الوقت" }, value: { en: "14:00–14:30", ar: "14:00–14:30" } },
      { label: { en: "Conflict check", ar: "فحص التعارض" }, value: { en: "Passed", ar: "لا يوجد تعارض" } },
    ],
    transcript: [
      { speaker: "assistant", text: { en: "What date and time would you prefer for the coordination meeting?", ar: "ما التاريخ والوقت الذي تفضلينه لاجتماع التنسيق؟" } },
      { speaker: "recipient", text: { en: "Sunday at two in the afternoon.", ar: "يوم الأحد الساعة الثانية ظهراً." } },
      { speaker: "assistant", text: { en: "That slot is available. I can confirm Sunday from 2:00 to 2:30 PM.", ar: "هذا الوقت متاح. يمكنني تأكيد الأحد من الثانية إلى الثانية والنصف ظهراً." } },
    ],
    writeback: { en: "Prepared the agreed start/end time, scheduled status, and summary comment.", ar: "تم تجهيز وقت البداية والنهاية وحالة الجدولة وتعليق الملخص." },
  },
  {
    id: "expiry",
    icon: "03",
    name: { en: "Document expiry reminder", ar: "تذكير انتهاء الوثائق" },
    short: { en: "Employee reminder", ar: "تذكير الموظف" },
    task: { en: "DEMO-316 · Professional licence renewal", ar: "DEMO-316 · تجديد الرخصة المهنية" },
    recipient: { en: "Khalid N. · Engineering team", ar: "خالد ن. · فريق الهندسة" },
    objective: { en: "Confirm renewal progress, expected completion, and any blocker.", ar: "تأكيد تقدم التجديد وموعد الإكمال المتوقع وأي عائق." },
    context: [
      { label: { en: "Expiry date", ar: "تاريخ الانتهاء" }, value: { en: "15 Oct 2026", ar: "15 أكتوبر 2026" } },
      { label: { en: "Reminder policy", ar: "سياسة التذكير" }, value: { en: "30 days before expiry", ar: "قبل الانتهاء بـ30 يوماً" } },
      { label: { en: "Automation", ar: "التنفيذ التلقائي" }, value: { en: "Off — confirmation required", ar: "متوقف — يتطلب تأكيداً" } },
      { label: { en: "Phone", ar: "الهاتف" }, value: { en: "+966 5X XXX 0384", ar: "+966 5X XXX 0384" } },
    ],
    result: [
      { label: { en: "Document", ar: "الوثيقة" }, value: { en: "Expiring", ar: "قاربت الانتهاء" } },
      { label: { en: "Renewal started", ar: "بدأ التجديد" }, value: { en: "Yes", ar: "نعم" } },
      { label: { en: "Expected completion", ar: "الإكمال المتوقع" }, value: { en: "22 Sep 2026", ar: "22 سبتمبر 2026" } },
      { label: { en: "Blocker", ar: "العائق" }, value: { en: "None", ar: "لا يوجد" } },
    ],
    transcript: [
      { speaker: "assistant", text: { en: "This is a reminder that your professional licence expires next month. Has renewal started?", ar: "هذا تذكير بأن رخصتك المهنية تنتهي الشهر القادم. هل بدأ التجديد؟" } },
      { speaker: "recipient", text: { en: "Yes, I submitted the renewal and expect it next week.", ar: "نعم، قدمت طلب التجديد وأتوقع اكتماله الأسبوع القادم." } },
      { speaker: "assistant", text: { en: "Thank you. I will record that there is no current blocker.", ar: "شكراً لك. سأوثق عدم وجود عائق حالياً." } },
    ],
    writeback: { en: "Prepared a renewal-status comment without requesting sensitive identity data.", ar: "تم تجهيز تعليق بحالة التجديد دون طلب بيانات هوية حساسة." },
  },
  {
    id: "supplier",
    icon: "04",
    name: { en: "Supplier quotation collection", ar: "جمع عروض أسعار الموردين" },
    short: { en: "Confidential negotiation", ar: "تفاوض سري" },
    task: { en: "DEMO-422 · Fire-alarm equipment RFQ", ar: "DEMO-422 · طلب تسعير معدات إنذار الحريق" },
    recipient: { en: "Noura S. · Supplier representative", ar: "نورة س. · ممثلة المورد" },
    objective: { en: "Collect a complete quote, request a discount, and protect competitor details.", ar: "جمع عرض كامل وطلب خصم وحماية بيانات الموردين الآخرين." },
    context: [
      { label: { en: "Items", ar: "المواد" }, value: { en: "20 detectors · 15 sprinkler heads", ar: "20 كاشفاً · 15 رأس رشاش" } },
      { label: { en: "Delivery", ar: "التسليم" }, value: { en: "Madinah", ar: "المدينة المنورة" } },
      { label: { en: "Competitor data", ar: "بيانات المنافسين" }, value: { en: "Never disclosed", ar: "لا يتم الإفصاح عنها" } },
      { label: { en: "Phone", ar: "الهاتف" }, value: { en: "+966 5X XXX 0496", ar: "+966 5X XXX 0496" } },
    ],
    result: [
      { label: { en: "Initial quote", ar: "السعر الأولي" }, value: { en: "SAR 8,450", ar: "8,450 ر.س" } },
      { label: { en: "Final quote", ar: "السعر النهائي" }, value: { en: "SAR 7,980", ar: "7,980 ر.س" } },
      { label: { en: "Discount", ar: "الخصم" }, value: { en: "5.6%", ar: "5.6%" } },
      { label: { en: "Delivery", ar: "التسليم" }, value: { en: "4 business days", ar: "4 أيام عمل" } },
    ],
    transcript: [
      { speaker: "assistant", text: { en: "Please confirm your price, VAT, stock, delivery, warranty, and quote validity.", ar: "يرجى تأكيد السعر والضريبة والمخزون والتسليم والضمان وصلاحية العرض." } },
      { speaker: "recipient", text: { en: "The total is 8,450 riyals including VAT, with delivery in four days.", ar: "الإجمالي 8,450 ريالاً شاملاً الضريبة، والتسليم خلال أربعة أيام." } },
      { speaker: "assistant", text: { en: "Could you offer your best price while keeping the same scope and delivery?", ar: "هل يمكن تقديم أفضل سعر مع الحفاظ على النطاق وموعد التسليم؟" } },
    ],
    writeback: { en: "Prepared a normalized quote for comparison; no purchase commitment was made.", ar: "تم تجهيز عرض موحد للمقارنة دون تقديم أي التزام بالشراء." },
  },
];

const ui = {
  en: {
    badge: "Public no-call demo",
    title: "Operations that can pick up the phone",
    intro: "Turn project work into a reviewable call plan, require human approval, then return structured results to the system of record.",
    safety: "Safe replay · zero external actions",
    source: "1 · Select source",
    approval: "2 · Human approval",
    call: "3 · Safe runtime replay",
    outcome: "4 · Structured result",
    writeback: "5 · Write-back",
    workflows: "Workflow library",
    selectedTask: "Selected work item",
    objective: "Call objective",
    context: "Useful source fields",
    prepare: "Prepare call preview",
    reviewTitle: "Review the exact call before anything happens",
    reviewText: "The live application masks the number, compiles only relevant source fields, and reserves a single-use confirmation ID. This public route performs a deterministic replay instead of placing a call.",
    disclosure: "The assistant will disclose that it is an AI calling on behalf of the organization.",
    confirmation: "I approve this one recipient, objective, and no-call replay.",
    run: "Run no-call replay",
    back: "Back to source",
    resultTitle: "Replay complete — structured result ready",
    resultText: "This fixture uses the same result shape expected from CALL-E, but no provider or business-system request was sent.",
    transcript: "Representative transcript",
    writebackTitle: "Write-back preview",
    writebackNote: "Preview only · not sent",
    reset: "Try another workflow",
    guardrails: "Guardrails visible in the product",
    guardrailItems: ["One explicit confirmation", "One recipient per request", "Duplicate-start protection", "No automatic follow-up", "Masked phone data", "Separate write-back approval"],
    architecture: "Project tool → field mapping → call preview → approval gate → CALL-E-ready execution → validated result → optional write-back",
    footer: "No credentials, personal data, calls, or external writes are used on this demo route.",
    assistant: "AI assistant",
    recipient: "Recipient",
  },
  ar: {
    badge: "عرض عام بلا مكالمة",
    title: "عمليات قادرة على إجراء الاتصال",
    intro: "حوّل مهام المشروع إلى خطة اتصال قابلة للمراجعة، واطلب موافقة بشرية، ثم أعد النتائج المنظمة إلى نظام العمل.",
    safety: "إعادة آمنة · بلا إجراءات خارجية",
    source: "1 · اختيار المصدر",
    approval: "2 · الموافقة البشرية",
    call: "3 · إعادة تشغيل آمنة",
    outcome: "4 · نتيجة منظمة",
    writeback: "5 · كتابة النتيجة",
    workflows: "مكتبة الخدمات",
    selectedTask: "مهمة العمل المختارة",
    objective: "هدف المكالمة",
    context: "حقول المصدر المفيدة",
    prepare: "تجهيز معاينة المكالمة",
    reviewTitle: "راجع المكالمة الدقيقة قبل تنفيذ أي إجراء",
    reviewText: "يخفي التطبيق الحقيقي الرقم ويجمع الحقول المرتبطة فقط ويحجز رمز تأكيد يستخدم مرة واحدة. هذا المسار العام يشغل إعادة حتمية بدلاً من إجراء مكالمة.",
    disclosure: "سيصرّح المساعد بأنه ذكاء اصطناعي يتصل نيابة عن الجهة.",
    confirmation: "أوافق على هذا المستلم والهدف وإعادة العرض بلا مكالمة.",
    run: "تشغيل إعادة العرض بلا مكالمة",
    back: "العودة إلى المصدر",
    resultTitle: "اكتملت الإعادة — النتيجة المنظمة جاهزة",
    resultText: "يستخدم هذا النموذج بنية النتيجة نفسها المتوقعة من CALL-E، لكن لم يُرسل أي طلب إلى المزود أو نظام العمل.",
    transcript: "نص تمثيلي للمحادثة",
    writebackTitle: "معاينة كتابة النتيجة",
    writebackNote: "معاينة فقط · لم تُرسل",
    reset: "تجربة خدمة أخرى",
    guardrails: "ضوابط واضحة داخل المنتج",
    guardrailItems: ["تأكيد صريح واحد", "مستلم واحد لكل طلب", "منع التشغيل المكرر", "لا متابعة تلقائية", "إخفاء رقم الهاتف", "موافقة مستقلة للكتابة"],
    architecture: "أداة المشروع ← ربط الحقول ← معاينة الاتصال ← بوابة الموافقة ← تنفيذ جاهز لـ CALL-E ← نتيجة متحققة ← كتابة اختيارية",
    footer: "لا يستخدم مسار العرض أي مفاتيح أو بيانات شخصية أو مكالمات أو كتابة خارجية.",
    assistant: "المساعد الذكي",
    recipient: "المستلم",
  },
};

export default function DemoClient() {
  const [language, setLanguage] = useState<Language>("en");
  const [serviceId, setServiceId] = useState(services[0].id);
  const [stage, setStage] = useState<Stage>("source");
  const [disclosure, setDisclosure] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const copy = ui[language];
  const service = useMemo(() => services.find((item) => item.id === serviceId) || services[0], [serviceId]);
  const local = (value: Localized) => value[language];

  function chooseService(id: string) {
    setServiceId(id);
    setStage("source");
    setDisclosure(false);
    setConfirmed(false);
  }

  function reset() {
    setStage("source");
    setDisclosure(false);
    setConfirmed(false);
  }

  const progress = stage === "source" ? 1 : stage === "review" ? 2 : 5;

  return (
    <main className={styles.demo} dir={language === "ar" ? "rtl" : "ltr"}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>N</span>
          <span><b>Noon Arch</b><small>AI Operations</small></span>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.safeBadge}><i />{copy.safety}</span>
          <button className={styles.language} onClick={() => setLanguage(language === "en" ? "ar" : "en")} aria-label="Switch language">{language === "en" ? "العربية" : "English"}</button>
        </div>
      </header>

      <section className={styles.intro}>
        <span className={styles.eyebrow}>{copy.badge}</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>

      <ol className={styles.stepper} aria-label="Workflow progress">
        {[copy.source, copy.approval, copy.call, copy.outcome, copy.writeback].map((label, index) => (
          <li key={label} className={index < progress ? styles.complete : index === progress ? styles.current : ""}>
            <span>{index < progress ? "✓" : index + 1}</span><b>{label.replace(/^\d · /, "")}</b>
          </li>
        ))}
      </ol>

      <div className={styles.workspace}>
        <aside className={styles.services}>
          <div className={styles.sectionLabel}>{copy.workflows}</div>
          {services.map((item) => (
            <button key={item.id} className={item.id === service.id ? styles.activeService : ""} onClick={() => chooseService(item.id)}>
              <span>{item.icon}</span><b>{local(item.name)}</b><small>{local(item.short)}</small>
            </button>
          ))}
          <div className={styles.guardrails}>
            <b>{copy.guardrails}</b>
            <ul>{copy.guardrailItems.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </aside>

        <section className={styles.surface}>
          {stage === "source" && <>
            <div className={styles.surfaceHead}><span>{service.icon}</span><div><small>{copy.selectedTask}</small><h2>{local(service.task)}</h2></div></div>
            <div className={styles.recipient}><span className={styles.avatar}>{local(service.recipient).slice(0, 1)}</span><div><small>{copy.recipient}</small><b>{local(service.recipient)}</b></div><em>{service.context[service.context.length - 1].value[language]}</em></div>
            <div className={styles.objective}><small>{copy.objective}</small><p>{local(service.objective)}</p></div>
            <h3>{copy.context}</h3>
            <dl className={styles.contextGrid}>{service.context.slice(0, -1).map((field) => <div key={local(field.label)}><dt>{local(field.label)}</dt><dd>{local(field.value)}</dd></div>)}</dl>
            <button className={styles.primary} onClick={() => setStage("review")}>{copy.prepare}<span>→</span></button>
          </>}

          {stage === "review" && <>
            <div className={styles.reviewHeader}><span className={styles.lock}>✓</span><div><small>{local(service.name)}</small><h2>{copy.reviewTitle}</h2></div></div>
            <p className={styles.reviewCopy}>{copy.reviewText}</p>
            <div className={styles.callContract}>
              <div><small>{copy.recipient}</small><b>{local(service.recipient)}</b><em>{service.context[service.context.length - 1].value[language]}</em></div>
              <div><small>{copy.objective}</small><b>{local(service.objective)}</b></div>
            </div>
            <label className={styles.check}><input type="checkbox" checked={disclosure} onChange={(event) => setDisclosure(event.target.checked)} /><span>{copy.disclosure}</span></label>
            <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{copy.confirmation}</span></label>
            <div className={styles.actionRow}><button className={styles.secondary} onClick={() => setStage("source")}>{copy.back}</button><button className={styles.primary} disabled={!disclosure || !confirmed} onClick={() => setStage("result")}>{copy.run}<span>→</span></button></div>
          </>}

          {stage === "result" && <>
            <div className={styles.resultHeader}><span>✓</span><div><small>{local(service.name)}</small><h2>{copy.resultTitle}</h2></div></div>
            <p className={styles.reviewCopy}>{copy.resultText}</p>
            <div className={styles.resultGrid}>{service.result.map((field) => <div key={local(field.label)}><span>{local(field.label)}</span><b>{local(field.value)}</b></div>)}</div>
            <h3>{copy.transcript}</h3>
            <div className={styles.transcript}>{service.transcript.map((turn, index) => <div key={index} className={turn.speaker === "assistant" ? styles.aiTurn : styles.personTurn}><span>{turn.speaker === "assistant" ? copy.assistant : copy.recipient}</span><p>{local(turn.text)}</p></div>)}</div>
            <div className={styles.writeback}><div><small>{copy.writebackTitle}</small><b>{local(service.writeback)}</b></div><em>{copy.writebackNote}</em></div>
            <button className={styles.secondary} onClick={reset}>{copy.reset}</button>
          </>}
        </section>
      </div>

      <section className={styles.architecture}><b>{copy.architecture}</b><span>{copy.footer}</span></section>
    </main>
  );
}
