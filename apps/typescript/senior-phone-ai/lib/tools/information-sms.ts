export const MAX_SMS_MESSAGE_LENGTH = 480;

export interface InformationSmsInput {
  readonly title: string;
  readonly when: string;
  readonly address?: string;
  readonly sourceUrl: string;
}

function bounded(name: string, value: string, maximum: number): string {
  if (value.trim() !== value || value.length < 1 || value.length > maximum) {
    throw new Error(`${name} must be non-empty, bounded, and trimmed`);
  }
  return value;
}

function safeSourceUrl(value: string): string {
  bounded("sourceUrl", value, 220);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sourceUrl must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("sourceUrl must use HTTP or HTTPS");
  }
  return url.toString();
}

export function composeInformationSms(input: InformationSmsInput): string {
  const lines = [
    bounded("title", input.title, 100),
    `When: ${bounded("when", input.when, 100)}`,
  ];
  if (input.address !== undefined) {
    lines.push(`Where: ${bounded("address", input.address, 140)}`);
  }
  lines.push(`Source: ${safeSourceUrl(input.sourceUrl)}`);
  const message = lines.join("\n");
  if (message.length > MAX_SMS_MESSAGE_LENGTH) {
    throw new Error("composed SMS is too long");
  }
  return message;
}
