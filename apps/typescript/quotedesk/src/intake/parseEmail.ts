// Customer email text -> RFQ skeleton. Deterministic regex extraction,
// no LLM: the demo must behave identically on every run.

export interface EmailIntake {
  quantity?: number;
  cpu?: string;
  neededBy?: string;
  sourceUrl?: string;
  gpu?: string;
  ramGb?: number;
  storageGb?: number;
  rawEmail: string;
}

export function parseEmail(raw: string): EmailIntake {
  const intake: EmailIntake = { rawEmail: raw };

  const url = raw.match(/https?:\/\/[^\s<>")]+/);
  if (url) intake.sourceUrl = url[0];

  const qty =
    raw.match(/(\d+)\s*(?:units?|pcs?|pieces?|nos\b)/i) ??
    raw.match(/\b(?:qty|quantity)\s*[:\-]?\s*(\d+)/i);
  if (qty) intake.quantity = Number(qty[1]);

  const date = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) intake.neededBy = date[1];

  const cpu = raw.match(/\b(Core\s+Ultra\s+\d\s+\w+|i[3579]-\w+|Ryzen(?:\s+AI)?\s+\d+\s*\w*)\b/i);
  if (cpu) intake.cpu = cpu[1].replace(/\s+/g, ' ');

  const gpu = raw.match(/\b((?:RTX|GTX)\s?-?\d{4}(?:\s?Ti)?)\b/i);
  if (gpu) intake.gpu = gpu[1].toUpperCase().replace(/\s+/g, ' ');

  const ram = raw.match(/(\d+)\s?GB\s+RAM/i);
  if (ram) intake.ramGb = Number(ram[1]);

  const storageTb = raw.match(/(\d+)\s?TB\s+(?:SSD|storage|HDD)/i);
  const storageGb = raw.match(/(\d{3,4})\s?GB\s+(?:SSD|storage|HDD)/i);
  if (storageTb) intake.storageGb = Number(storageTb[1]) * 1024;
  else if (storageGb) intake.storageGb = Number(storageGb[1]);

  return intake;
}
