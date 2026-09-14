import { mockEmails } from "./mockInbox";

export interface RecentEmail {
  gmailMessageId: string;
  sender: string;
  subject: string;
  bodySnippet: string;
}

/**
 * Returns the user's "recent emails". For this hackathon demo, real Gmail
 * OAuth has been replaced with a seeded mock inbox (see lib/mockInbox.ts).
 * The `userId` parameter is kept so callers don't need to change and so a
 * real integration can be dropped back in later with the same signature.
 */
export async function fetchRecentEmails(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId: string
): Promise<RecentEmail[]> {
  return mockEmails.map((email) => ({
    gmailMessageId: email.gmailMessageId,
    sender: email.sender,
    subject: email.subject,
    bodySnippet: email.body,
  }));
}
