import { getDb } from "../../../../server/get-db";
import { parseResetFormInput } from "../../../../../application/live-input";
import { resetSyntheticCase } from "../../../../../application/reset-synthetic-case";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = await getDb();
  try {
    parseResetFormInput(await req.formData());
    await resetSyntheticCase(db, { caseId: id });
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
