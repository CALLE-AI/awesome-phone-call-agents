import { getDb } from "../../../../server/get-db";
import { getIntentCaseId } from "../../../../../infrastructure/db";
import { parseEscalateFormInput } from "../../../../../application/live-input";
import { escalateToHuman } from "../../../../../application/escalate";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = await getDb();
  try {
    const input = parseEscalateFormInput(await req.formData());
    const ownerCaseId = await getIntentCaseId(db, input.intentId);
    if (ownerCaseId && ownerCaseId !== id) {
      return redirectToCase(req, id, "intent does not belong to this case");
    }
    await escalateToHuman(db, input);
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
