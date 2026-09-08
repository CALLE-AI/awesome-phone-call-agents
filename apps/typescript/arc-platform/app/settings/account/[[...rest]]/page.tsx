import { UserProfile } from "@clerk/nextjs";

import { arcUserProfileAppearance } from "@/components/auth/appearance";

export const metadata = { title: "Account — Settings — Arc Platform" };

/**
 * The signed-in person's own account: email addresses, password, connected
 * accounts, active sessions. All of it is Clerk's, and Clerk's UserProfile is
 * the only thing that can edit it - the app has no copy of any of these
 * fields, so a hand-written form here would be a form over nothing.
 *
 * It was already reachable, but only by opening the avatar menu and picking
 * "Manage account", which puts it in a modal and nowhere in Settings. This
 * gives it a URL.
 *
 * The optional catch-all is Clerk's requirement, not ours: with
 * routing="path" it navigates to /settings/account/security and similar, and
 * those have to resolve to this same page.
 */
export default function AccountSettingsPage() {
  return (
    <UserProfile
      path="/settings/account"
      routing="path"
      appearance={arcUserProfileAppearance}
    />
  );
}
