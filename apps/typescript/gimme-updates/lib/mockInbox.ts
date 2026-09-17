export interface MockEmail {
  gmailMessageId: string;
  sender: string;
  subject: string;
  body: string;
}

/**
 * Seeded mock inbox used in place of real Gmail OAuth for this hackathon
 * demo. See lib/emailSource.ts for how these are surfaced to the app.
 */
export const mockEmails: MockEmail[] = [
  {
    gmailMessageId: "mock-1",
    sender: "billing@cityelectric.com",
    subject: "Your electricity bill for September",
    body: "Your bill amount is $142.30, up from $98.50 last month due to a tariff revision. Due date: Sept 25.",
  },
  {
    gmailMessageId: "mock-2",
    sender: "loans@firstnationalbank.com",
    subject: "EMI Payment Reminder",
    body: "Your monthly EMI of $310 is due on Sept 30. Please ensure sufficient balance.",
  },
  {
    gmailMessageId: "mock-3",
    sender: "notifications@pensionboard.gov",
    subject: "Pension Update Available",
    body: "Your quarterly pension statement is now available. No action required unless you have questions.",
  },
  {
    gmailMessageId: "mock-4",
    sender: "deals@bigsavingsmart.com",
    subject: "50% OFF Everything This Weekend!",
    body: "Huge savings on electronics, home goods, and more!",
  },
  {
    gmailMessageId: "mock-5",
    sender: "support@healthinsureco.com",
    subject: "Claim Status Update",
    body: "Your recent claim #48213 has been processed. A refund of $45 will be issued within 5-7 business days.",
  },
];
