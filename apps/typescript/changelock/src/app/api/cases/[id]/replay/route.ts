import { getDb } from "../../../../server/get-db";
import { createPreview } from "../../../../../application/create-preview";
import { authorizeIntent } from "../../../../../application/authorize-intent";
import { dispatchCall } from "../../../../../application/dispatch-call";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = await getDb();
  try {
    const form = await req.formData();
    const scenario = String(form.get("scenario") ?? "");
    const typedPhrase = String(form.get("typedPhrase") ?? "");
    const attested = form.get("attestedConsentingContact") === "on";
    const preview = await createPreview(db, id);
    const intent = await authorizeIntent(db, {
      caseId: id,
      typedPhrase,
      attestedConsentingContact: attested,
      preview,
    });
    await dispatchCall(db, { intentId: intent.id, scenario });
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
