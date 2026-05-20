/**
 * SettingsButton — floating cog in the corner of the AI app.
 *
 * Anchored top-right with safe-area padding so it sits cleanly on
 * notch / Dynamic Island devices. Clicking opens the settings
 * modal on the default "Account" section.
 *
 * Kept as a separate, free-floating layer (not inside AIScreen)
 * because AIScreen is shared code with Bas Udrus — we don't want
 * a duplicate Settings button to appear on basudrus.com's AI tab.
 */
import { Settings as SettingsIcon } from "lucide-react";
import { openSettings } from "./useSettingsState";

export function SettingsButton() {
  return (
    <button
      onClick={() => openSettings("account")}
      aria-label="Open settings"
      title="Settings"
      className="
        fixed top-3 end-3 z-40
        h-10 w-10 grid place-items-center
        rounded-full bg-surface-1/80 backdrop-blur-md
        border border-line/60 shadow-sm
        text-ink-2 hover:text-ink-1 hover:bg-surface-2
        transition
      "
      style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
    >
      <SettingsIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
