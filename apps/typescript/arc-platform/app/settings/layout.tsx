import AppShell from "@/components/app-shell/AppShell";
import SettingsNav from "./_components/SettingsNav";

/**
 * One frame for every settings section.
 *
 * The heading and the section nav live here rather than on each page, so
 * Brand, Billing and Account cannot drift apart - and so /settings/billing
 * stops being a page you can only arrive at, with no way to see what else is
 * in here.
 *
 * AppShell already draws the breadcrumb in the top bar. The pages below used
 * to draw their own as well, which put "Dashboard / Settings" on the screen
 * twice; they no longer do.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-h1 text-text">Settings</h1>
          <p className="text-small text-text-muted">
            Your brand, your plan, and the account you sign in with.
          </p>
        </header>

        <SettingsNav />

        {children}
      </div>
    </AppShell>
  );
}
