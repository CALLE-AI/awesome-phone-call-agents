import { randomUUID } from "node:crypto";
import { buildCallTask } from "./call-task.js";
import { extractPublishedUsPhone, maskPhone, normalizeUsPhone, stableFingerprint } from "./privacy.js";
import type { CallPreview, CallResult, CpscRecall, PendingPreview, PreviewInput } from "./types.js";
import type { CallProvider } from "./providers.js";

const PREVIEW_TTL_MS = 15 * 60 * 1000;

export class RecallWorkflow {
  readonly pending = new Map<string, PendingPreview>();

  createPreview(recall: CpscRecall, input: PreviewInput, liveCallsEnabled: boolean): CallPreview {
    const modelNumber = input.modelNumber.trim().slice(0, 60);
    if (!modelNumber) throw new Error("A model number or exact product identifier is required.");

    let phoneSource: CallPreview["phoneSource"] = "official_recall_record";
    let phone = extractPublishedUsPhone(recall.consumerContact);

    if (input.demoPhone) {
      if (input.demoConsent !== true) {
        throw new Error("Demo calls require an explicit ownership or permission attestation.");
      }
      phone = normalizeUsPhone(input.demoPhone);
      phoneSource = "authorized_demo";
    }
    if (!phone) throw new Error("No valid callable U.S. number is available for this preview.");

    const previewId = randomUUID();
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const task = buildCallTask(recall, modelNumber, input.dateCode);
    const preview: CallPreview = {
      previewId,
      expiresAt,
      maskedPhone: maskPhone(phone),
      phoneSource,
      product: recall.products[0]?.name || recall.title,
      modelNumber,
      dateCode: input.dateCode?.trim().slice(0, 40) || null,
      callGoal: "Verify item eligibility and obtain the minimum safe recall remedy steps.",
      boundaries: [
        "Automated-assistant disclosure at the start",
        "No name, address, email, account, order, payment, password, health data, or full serial number",
        "No purchase, binding acceptance, appointment, or claim that the product is safe",
        "Ambiguity becomes unknown; sensitive follow-up becomes a human handoff",
        "One approved call only; preview is single-use and expires in 15 minutes",
      ],
      officialRecordUrl: recall.officialUrl,
      liveCallsEnabled,
    };
    this.pending.set(previewId, { preview, phone, task, recall, consumed: false });
    return preview;
  }

  async execute(previewId: string, approvalPhrase: string, provider: CallProvider): Promise<CallResult> {
    const pending = this.pending.get(previewId);
    if (!pending) throw new Error("Preview not found. Create a new preview.");
    if (pending.consumed) throw new Error("This preview has already been used.");
    if (Date.parse(pending.preview.expiresAt) <= Date.now()) {
      this.pending.delete(previewId);
      throw new Error("Preview expired. Create and inspect a new preview.");
    }
    if (approvalPhrase !== "CALL NOW") throw new Error('Type "CALL NOW" to approve this one call.');

    pending.consumed = true;
    const fingerprint = stableFingerprint(
      String(pending.recall.id),
      pending.preview.modelNumber,
      pending.phone,
      pending.preview.expiresAt,
    );
    return provider.run(pending.phone, pending.task, fingerprint);
  }
}
