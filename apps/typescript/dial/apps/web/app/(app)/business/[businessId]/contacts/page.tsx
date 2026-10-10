'use client';

import { useParams } from 'next/navigation';
import { ContactsManager } from '@/components/business/contacts-manager';

export default function BusinessContactsPage() {
  const { businessId } = useParams<{ businessId: string }>();
  return <ContactsManager businessId={businessId} />;
}
