import { getDb } from "../../../../server/get-db";
import { parseEscalateFormInput } from "../../../../../application/live-input";
import { escalateToHuman } from "../../../../../application/escalate";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  try {
    const input = parseEscalateFormInput(await req.formData());
    const intent = db
      .prepare("SELECT case_id FROM call_intents WHERE id = ?")
      .get(input.intentId) as { case_id: string } | undefined;
    if (intent && intent.case_id !== id) {
      return redirectToCase(req, id, "intent does not belong to this case");
    }
    escalateToHuman(db, input);
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
