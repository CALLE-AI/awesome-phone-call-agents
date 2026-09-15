import { buildResultView } from "./result";
import { maskPhone } from "./phone";
import type { Session } from "./types";

/** Consent and ownership stay server-side; summaries expose only a masked destination. */
export function publicView(session: Session) {
  const view = buildResultView(session);
  const { authorization, ownerId: _owner, ...safeSession } = view.session;
  const phone = authorization?.phone ?? session.application.candidatePhone;
  const serialized = JSON.stringify({ ...view, session: { ...safeSession, application: { ...safeSession.application, candidatePhone: phone ? maskPhone(phone) : undefined } } });
  return JSON.parse(phone ? serialized.split(phone).join(maskPhone(phone)) : serialized) as ReturnType<typeof buildResultView>;
}
