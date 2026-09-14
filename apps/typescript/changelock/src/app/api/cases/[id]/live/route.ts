import { getDb } from "../../../../server/get-db";
import { createPreview } from "../../../../../application/create-preview";
import { authorizeIntent } from "../../../../../application/authorize-intent";
import { dispatchCall } from "../../../../../application/dispatch-call";
import { parseLiveFormInput } from "../../../../../application/live-input";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (process.env.CHANGELOCK_MODE !== "live") {
    return redirectToCase(req, id, "live mode is not enabled on this server");
  }
  const db = await getDb();
  try {
    const input = parseLiveFormInput(await req.formData());
    const preview = await createPreview(db, id);
    const intent = await authorizeIntent(
      db,
      {
        caseId: id,
        typedPhrase: input.typedPhrase,
        attestedConsentingContact: input.attestedConsentingContact,
        preview,
      },
      "live",
    );
    await dispatchCall(db, { intentId: intent.id });
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
