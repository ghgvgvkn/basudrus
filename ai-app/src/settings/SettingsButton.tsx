/**
 * SettingsButton — inline icon button sized to match QuotaChip / Go Pro.
 *
 * Designed to sit at the END of AIScreen's header row, immediately after
 * "10 / 10 left today" and the "Go Pro" button. Same 32px height as the
 * surrounding chips so the row reads as one unit.
 *
 * Free users see: [streak] [10/10 left today] [Go Pro] [⚙]
 * Pro users see:  [streak] [Pro ∞]                    [⚙]
 *
 * Lives in ai-app/ — basudrus.com's AIScreen header doesn't render this.
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
        h-8 w-8 shrink-0 rounded-full
        inline-flex items-center justify-center
        text-ink/65 hover:text-ink hover:bg-ink/5
        transition active:scale-[0.95]
      "
    >
      <SettingsIcon className="h-[15px] w-[15px]" />
    </button>
  );
}
