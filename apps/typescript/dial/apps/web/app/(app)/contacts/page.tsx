import { getContacts } from '@/lib/session';
import { ContactsList } from '@/components/contacts-list';

export default async function ContactsPage() {
  const result = await getContacts();
  if (!result) {
    return <div className="empty-state">Contacts could not be loaded.</div>;
  }
  return <ContactsList initial={result.contacts} />;
}
