'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PhoneIcon, CardIcon, KeyIcon, UserIcon } from './icons';

/**
 * The settings sections, each a real page.
 *
 * Calling, Usage, Permissions and the account link all pointed at `/settings`
 * — four sidebar entries, one destination, and no way to tell from the URL
 * which of them you had followed. They are separate routes now, so each is
 * linkable, bookmarkable, and back-navigable on its own.
 */

export const SETTINGS_SECTIONS = [
  {
    href: '/settings/calling',
    label: 'Calling',
    description: 'How Dial sounds and behaves on the phone.',
    Icon: PhoneIcon,
  },
  {
    href: '/settings/usage',
    label: 'Usage',
    description: 'Calls and tasks used, against your daily limit.',
    Icon: CardIcon,
  },
  {
    href: '/settings/permissions',
    label: 'Permissions',
    description: 'What Dial may do, and what it may say about you.',
    Icon: KeyIcon,
  },
  {
    href: '/settings/account',
    label: 'Account',
    description: 'Your details, your data, and signing out.',
    Icon: UserIcon,
  },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="settings-tabs" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="settings-tab"
          aria-current={pathname === href ? 'page' : undefined}
        >
          <Icon size={18} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
