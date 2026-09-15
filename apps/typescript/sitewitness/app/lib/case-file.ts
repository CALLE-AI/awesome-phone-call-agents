export const CASE_ID = "GAP-DRY-LIVE-002";
export const INTERVIEW_ID = "INT-047-BAKER-LIVE-002";
export const SOURCE_RECORDS = [
  {
    id: "directory",
    title: "Historical directory extract",
    date: "1987–1994",
    suppliedBy: "Prepared synthetic case packet",
    location: "Page 1, entry 47",
    file: "/records/baker-directory.html",
    excerpt:
      "47 Baker Street — Sparkle Cleaners, listed from 1987 through 1994.",
    meaning:
      "A business listing identifies a cleaner at this address. It does not establish where cleaning took place.",
  },
  {
    id: "questionnaire",
    title: "Owner questionnaire",
    date: "22 August 2026",
    suppliedBy: "Synthetic current owner",
    location: "Page 1, question 4",
    file: "/records/baker-questionnaire.html",
    excerpt: "I believe it was only a drop shop.",
    meaning:
      "The owner reports a belief. Its source, applicable years and basis of knowledge are not established.",
  },
  {
    id: "referral",
    title: "Property-team referral note",
    date: "22 August 2026",
    suppliedBy: "Synthetic property team",
    location: "Page 1, respondent referral",
    file: "/records/baker-referral.html",
    excerpt:
      "Morgan Lee was the property manager from 1991 to 1996 and may know the tenant's operations. Contact details must be obtained separately.",
    meaning:
      "This referral identifies a potential witness. It supplies no telephone number or permission to call.",
  },
  {
    id: "contacts",
    title: "People to interview",
    date: "Prepared for the live demo",
    suppliedBy: "Fictional property team",
    location: "Contact list, page 1",
    file: "/records/demo-contact-list.html",
    excerpt:
      "Carol Chen may know 1987–1991. Sam Patel may know 1994. Interview each person to confirm their firsthand knowledge.",
    meaning:
      "These are supplied fictional roles for consenting test participants. Enter a participant's actual phone number and permission before calling. Referral periods are not evidence.",
  },
] as const;

export type Contact = {
  id: string;
  name: string;
  role: string;
  expectedPeriod: string;
  source: string;
  sourceRecord: string | null;
  sourceQuote: string;
  sourceRun: number | null;
  phone: string;
  phoneSource: string;
  permissionNote: string;
  automatedAllowed: boolean;
  transcriptionAllowed: boolean;
  version: number;
};
export type PublicContact = Omit<Contact, "phone"> & {
  hasPhone: boolean;
  maskedPhone: string;
  readiness: string;
};
export type SourceTask = {
  id: string;
  contactId: string | null;
  title: string;
  summary: string;
  assignee: string;
  status: "open" | "completed";
  createdAt: string;
  updatedAt: string;
};
export const INITIAL_CONTACT: Contact = {
  id: "morgan",
  name: "Morgan Lee",
  role: "Former property manager",
  expectedPeriod:
    "1991–1996 (property-team referral; confirm during interview)",
  source: "Property-team referral note, page 1",
  sourceRecord: "referral",
  sourceQuote: SOURCE_RECORDS[2].excerpt,
  sourceRun: null,
  phone: "",
  phoneSource: "",
  permissionNote: "",
  automatedAllowed: false,
  transcriptionAllowed: false,
  version: 0,
};
export function contactReadiness(contact: Contact | PublicContact | null) {
  if (!contact) return "No respondent identified";
  if (!("phone" in contact ? contact.phone : contact.hasPhone))
    return "Contact details needed";
  if (
    !contact.phoneSource ||
    !contact.permissionNote ||
    !contact.automatedAllowed ||
    !contact.transcriptionAllowed
  )
    return "Permission needed";
  return "Ready for authorized call";
}
export function publicContact(contact: Contact): PublicContact {
  const { phone, ...rest } = contact;
  return {
    ...rest,
    hasPhone: Boolean(phone),
    maskedPhone: phone ? `••• ••• ${phone.slice(-4)}` : "Not supplied",
    readiness: contactReadiness(contact),
  };
}
export function validateContact(value: Contact) {
  if (!value.name.trim() || !value.role.trim() || !value.source.trim())
    throw new Error(
      "A name, relationship to the property and contact source are required.",
    );
  if (value.phone && !/^\+[1-9]\d{7,14}$/.test(value.phone))
    throw new Error(
      "Use an international phone number beginning with + and country code.",
    );
  if (value.phone && !value.phoneSource.trim())
    throw new Error("Record who supplied this phone number.");
  if (
    (value.automatedAllowed || value.transcriptionAllowed) &&
    (!value.phone || !value.permissionNote.trim())
  )
    throw new Error(
      "Record the participant's permission and supply a phone number first.",
    );
  for (const text of [
    value.name,
    value.role,
    value.expectedPeriod,
    value.source,
    value.phoneSource,
    value.permissionNote,
  ])
    if (text.length > 1000)
      throw new Error("Contact fields must be 1,000 characters or fewer.");
}

// This live presentation case has its own contact and task history.
export const CONTACT_PREFIX = `${CASE_ID}:CONTACT:`;
export const TASK_PREFIX = `${CASE_ID}:SOURCE-TASK:`;
export const CONTACT_SELECTION = `${CASE_ID}:SELECTED-CONTACT`;
export const INITIAL_CONTACTS: Contact[] = [
  INITIAL_CONTACT,
  {
    ...INITIAL_CONTACT,
    id: "carol",
    name: "Carol Chen",
    role: "Earlier operator",
    expectedPeriod: "1987–1991 (supplied referral; confirm during interview)",
    source: "Prepared fictional contact list",
    sourceRecord: "contacts",
    sourceQuote:
      "Carol Chen may know operations from 1987 through 1991. The interview must establish her personal knowledge.",
  },
  {
    ...INITIAL_CONTACT,
    id: "sam",
    name: "Sam Patel",
    role: "Later manager",
    expectedPeriod: "1994 (supplied referral; confirm during interview)",
    source: "Prepared fictional contact list",
    sourceRecord: "contacts",
    sourceQuote:
      "Sam Patel may know 1994. Confirm what Sam observed and which areas Sam entered.",
  },
];
