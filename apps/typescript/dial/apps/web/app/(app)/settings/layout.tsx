import { SettingsNav } from '@/components/settings-nav';

/**
 * The frame every settings section shares: one heading, one row of tabs.
 *
 * Rendered by the layout rather than by each page so the tabs do not unmount
 * as you move between sections.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-shell">
      <header className="page-header" style={{ margin: 0 }}>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          What Dial may do on your behalf, and what it must ask you about first.
        </p>
      </header>

      <SettingsNav />

      {children}
    </div>
  );
}
