/**
 * ScreenHeader — sticky top bar for secondary screens (Subscription,
 * Notifications, Settings, etc.). The primary screens (Home, Discover,
 * AI, Connect, Rooms, Profile) own their own hero; this is for the
 * "pushed" surfaces that have a back affordance.
 *
 * Intentionally minimal — back arrow + title. No right-side slot by
 * default; if a screen needs actions it can compose its own.
 */
import { ChevronLeft } from "lucide-react";

export function ScreenHeader({
  title, onBack, right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 bg-bg/85 backdrop-blur border-b border-ink/8">
      <div className="h-14 px-3 md:px-6 flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="w-10 h-10 rounded-full inline-flex items-center justify-center text-ink/70 hover:bg-ink/5 hover:text-ink transition"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <h1 className="text-lg font-medium">{title}</h1>
        <div className="ml-auto">{right}</div>
      </div>
    </header>
  );
}
