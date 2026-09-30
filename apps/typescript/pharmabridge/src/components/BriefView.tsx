"use client";
import { Bot, CheckCircle2, CreditCard, Handshake, Lock, MessageSquareQuote, Stethoscope, Target, Timer, Voicemail, XCircle } from "lucide-react";
import type { BriefSpec, GuardrailId } from "@/lib/types";
import { Chip } from "./ui";

const GUARDRAIL_ICONS: Record<GuardrailId, typeof Bot> = {
  ai: Bot,
  privacy: Lock,
  medical: Stethoscope,
  payment: CreditCard,
  voicemail: Voicemail,
  time: Timer,
  accept: Handshake,
};

interface SchemaField {
  name: string;
  type: string;
  values: string[];
  description: string;
}

function schemaFields(schema: Record<string, unknown> | null | undefined): SchemaField[] {
  const properties = (schema?.properties ?? {}) as Record<string, { type?: string; enum?: string[]; description?: string }>;
  return Object.entries(properties).map(([name, spec]) => ({
    name,
    type: spec.enum ? "choice" : (spec.type ?? "string"),
    values: spec.enum ?? [],
    description: spec.description ?? "",
  }));
}

/** The agent's instructions as cards: goal, subject, call flow, guardrails, and the data it must return. */
export function BriefView({ brief, resultSchema }: { brief: BriefSpec; resultSchema?: Record<string, unknown> | null }) {
  const fields = schemaFields(resultSchema);
  return (
    <div className="space-y-5">
      <div className="soft-brand rounded-2xl p-5 ring-1 ring-violet-100">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700">
          <Target className="h-4 w-4" /> {brief.title}
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-800">{brief.goal}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {brief.target.map((item) => (
            <div key={item.label} className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-slate-200/70">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
              <div className="mt-0.5 text-[13px] font-semibold text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
        {brief.notes.map((note) => (
          <p key={note} className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            {note}
          </p>
        ))}
      </div>

      <div>
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Call flow</div>
        <ol className="relative space-y-3 border-l-2 border-dashed border-violet-200 pl-6">
          <li className="relative">
            <span className="brand-bg absolute -left-[33px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white">1</span>
            <div className="text-[13px] font-semibold text-slate-800">Open with an AI disclosure</div>
            <div className="mt-1.5 flex gap-2 rounded-2xl rounded-tl-sm bg-violet-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-violet-900 ring-1 ring-violet-100">
              <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              &ldquo;{brief.opening}&rdquo;
            </div>
          </li>
          {brief.steps.map((step, i) => (
            <li key={step.title} className="relative">
              <span className="absolute -left-[33px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-violet-700 ring-2 ring-violet-200">
                {i + 2}
              </span>
              <div className="text-[13px] font-semibold text-slate-800">{step.title}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>

      {(brief.ifYes.length > 0 || brief.ifNo.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {brief.ifYes.length > 0 && (
            <div className="rounded-2xl bg-emerald-50/70 p-4 ring-1 ring-emerald-100">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> If yes, ask
              </div>
              <ul className="space-y-1.5 text-[12.5px] leading-snug text-emerald-950/80">
                {brief.ifYes.map((q) => (
                  <li key={q} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {brief.ifNo.length > 0 && (
            <div className="rounded-2xl bg-rose-50/70 p-4 ring-1 ring-rose-100">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-700">
                <XCircle className="h-4 w-4" /> If no
              </div>
              <ul className="space-y-1.5 text-[12.5px] leading-snug text-rose-950/80">
                {brief.ifNo.map((q) => (
                  <li key={q} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Guardrails</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {brief.guardrails.map((g) => {
            const Icon = GUARDRAIL_ICONS[g.id];
            return (
              <div key={g.text} className="flex gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <span className="text-[12px] leading-snug text-slate-600">{g.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {fields.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Data CALL-E must return</span>
            <span className="text-[11px] text-slate-400">{fields.length} fields · closed JSON schema</span>
          </div>
          <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
            {fields.map((field) => (
              <div key={field.name} className="grid gap-1 border-b border-slate-100 bg-white px-4 py-2.5 last:border-0 sm:grid-cols-[200px_1fr]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11.5px] font-semibold text-slate-800">{field.name}</span>
                  <Chip tone={field.type === "choice" ? "violet" : field.type === "number" ? "sky" : "slate"} className="px-1.5 py-0 text-[9.5px]">
                    {field.type}
                  </Chip>
                </div>
                <div>
                  {field.values.length > 0 && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {field.values.map((v) => (
                        <span key={v} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="line-clamp-2 text-[11.5px] leading-snug text-slate-500">{field.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
