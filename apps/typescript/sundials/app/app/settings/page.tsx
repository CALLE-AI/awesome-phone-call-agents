import { SettingsPanel } from "@/lib/console/SettingsPanel";
import { readWorkspaceSettings } from "@/lib/console/workspace-settings";

export default function SettingsPage() {
  return <SettingsPanel initial={readWorkspaceSettings()} />;
}
