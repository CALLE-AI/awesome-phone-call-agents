import { redirect } from 'next/navigation';

/**
 * Settings is four pages now. This keeps old links, bookmarks and the
 * post-sign-in path working by sending them to the first section rather than
 * showing a fifth page that duplicates the others.
 */
export default function SettingsIndexPage() {
  redirect('/settings/calling');
}
