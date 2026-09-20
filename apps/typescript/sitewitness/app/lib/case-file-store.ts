import { type DemoSession } from "./demo-session.ts";
import {
  INITIAL_CONTACT,
  INITIAL_CONTACTS,
  publicContact,
  validateContact,
  type Contact,
  type SourceTask,
} from "./case-file.ts";

type EventRow = {
  id: number;
  entity_id: string;
  detail: string;
  created_at: string;
};
export const contactEntity = (id: string, session: DemoSession) =>
  `${session.caseId}:CONTACT:${id}`;
export async function readCaseFile(db: D1Database, session: DemoSession) {
  const CONTACT_PREFIX = `${session.caseId}:CONTACT:`;
  const TASK_PREFIX = `${session.caseId}:SOURCE-TASK:`;
  const CONTACT_SELECTION = `${session.caseId}:SELECTED-CONTACT`;
  // UUID-based demo IDs exceed D1's LIKE-pattern limit once suffixed.
  // Compare literal prefixes so existing cases retain their identities.
  const rows = await db
    .prepare(
      "SELECT id, entity_id, detail, created_at FROM audit_events WHERE substr(entity_id, 1, ?) = ? OR substr(entity_id, 1, ?) = ? OR entity_id = ? ORDER BY id",
    )
    .bind(
      CONTACT_PREFIX.length,
      CONTACT_PREFIX,
      TASK_PREFIX.length,
      TASK_PREFIX,
      CONTACT_SELECTION,
    )
    .all<EventRow>();
  const contacts = new Map<string, Contact>([
    ...INITIAL_CONTACTS.map((contact): [string, Contact] => [
      contact.id,
      { ...contact },
    ]),
  ]);
  const tasks = new Map<string, SourceTask>();
  let selectedContactId: string | null = INITIAL_CONTACT.id;
  for (const row of rows.results) {
    const value = JSON.parse(row.detail);
    if (row.entity_id === CONTACT_SELECTION)
      selectedContactId = value.contactId;
    else if (row.entity_id.startsWith(CONTACT_PREFIX))
      contacts.set(value.id, { ...value, version: row.id });
    else tasks.set(value.id, value);
  }
  return {
    contacts: [...contacts.values()],
    tasks: [...tasks.values()],
    selectedContactId,
  };
}
export async function contactById(
  db: D1Database,
  id: string,
  session: DemoSession,
) {
  const state = await readCaseFile(db, session);
  return state.contacts.find((contact) => contact.id === id) || null;
}
export async function saveContact(
  db: D1Database,
  contact: Contact,
  session: DemoSession,
  actor = "Coordinator",
) {
  validateContact(contact);
  const result = await db
    .prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) SELECT 'CASE_CONTACT_SAVED', ?, ?, ?, ? WHERE COALESCE((SELECT MAX(id) FROM audit_events WHERE entity_id = ?), 0) = ?",
    )
    .bind(
      contactEntity(contact.id, session),
      JSON.stringify(contact),
      actor,
      new Date().toISOString(),
      contactEntity(contact.id, session),
      contact.version,
    )
    .run();
  if (!result.meta.changes)
    throw new Error(
      "This contact changed in another session. Refresh before saving.",
    );
  return contactById(db, contact.id, session);
}
export async function publicCaseFile(db: D1Database, session: DemoSession) {
  const state = await readCaseFile(db, session);
  return { session, ...state, contacts: state.contacts.map(publicContact) };
}
