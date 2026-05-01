/**
 * SubscriptionScreen — Free / Pro comparison + Pro management.
 *
 * Legacy-map: none (new surface). Hooks into AppContext.subscription.
 *
 * Two states:
 *   - tier === "free"  → side-by-side comparison card, CTA to upgrade.
 *   - tier === "pro"   → manage: renewal date, payment method, cancel.
 *
 * Pricing is hardcoded for the bundle. The live port should:
 *   1. Read the price from `prices` in your Paddle/Stripe account.
 *   2. Wire upgradeToPro() to open Paddle Checkout (or stripe session).
 *   3. Drive tier/renewsAt/paymentLast4 from webhook-populated
 *      profile_subscriptions rows in Supabase.
 */
import { useApp } from "@/context/AppContext";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Check, Infinity as InfinityIcon, Sparkles, Zap, Clock } from "lucide-react";
import { PAYMENTS_LIVE } from "@/lib/featureFlags";

export function SubscriptionScreen() {
  const { subscription, upgradeToPro, cancelPro, setScreen } = useApp();

  if (subscription.tier === "pro") {
    return <ManagePro onCancel={cancelPro} sub={subscription} onBack={() => setScreen("profile")} />;
  }
  return <ShowUpgrade onUpgrade={upgradeToPro} onBack={() => setScreen("profile")} sub={subscription} />;
}

function ShowUpgrade({
  onUpgrade, onBack, sub,
}: {
  onUpgrade: () => void;
  onBack: () => void;
  sub: ReturnType<typeof useApp>["subscription"];
}) {
  return (
    <div className="min-h-full">
      <ScreenHeader title="Upgrade" onBack={onBack} />

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-ink text-bg text-xs font-medium">
            <Sparkles size={13} />
            Bas Udrus Pro
          </div>
          <h1 className="mt-5 font-serif italic text-5xl md:text-6xl leading-[1.02]">
            Study without<br/>the ceiling.
          </h1>
          <p className="mt-5 text-ink/70 text-lg max-w-xl mx-auto">
            Unlimited AI, priority matching, and the features we add this year.
          </p>
        </div>

        {/* Comparison */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Plan
            name="Free"
            price="JD 0"
            cadence="forever"
            current={sub.tier === "free"}
            features={[
              `${sub.aiCap} AI messages / day`,
              "Join up to 3 study rooms",
              "Standard Discover matching",
              "1-on-1 chat",
            ]}
          />
          <Plan
            name="Pro"
            price="JD 3.99"
            cadence="/ month"
            featured
            comingSoon={!PAYMENTS_LIVE}
            features={[
              { icon: <InfinityIcon size={14}/>, text: "Unlimited AI (Omar + Noor)" },
              { icon: <Zap size={14}/>, text: "Priority Discover placement" },
              "Upload PDFs, docs, images to AI",
              "Voice messages in chat",
              "Unlimited study rooms",
              "Early access to new features",
            ]}
            cta={
              PAYMENTS_LIVE ? (
                <button
                  onClick={onUpgrade}
                  className="w-full h-12 rounded-full bg-bg text-ink font-medium hover:bg-bg/90 transition"
                >
                  Upgrade — JD 3.99 / mo
                </button>
              ) : (
                // Payments not yet wired — show a disabled, designed
                // state so the plan card still looks beautiful but
                // nobody can flip themselves to Pro for free.
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="w-full h-12 rounded-full bg-bg/30 text-bg/80 font-medium cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  <Clock size={14} />
                  Coming soon
                </button>
              )
            }
          />
        </div>

        {PAYMENTS_LIVE ? (
          <p className="mt-8 text-center text-ink/50 text-xs">
            Billed monthly. Cancel anytime. Student pricing for .edu.eg emails.
          </p>
        ) : (
          <p className="mt-8 text-center text-ink/55 text-xs max-w-md mx-auto">
            Pro is coming soon — payments are still being set up. Free tier
            is fully active and will stay free for every student. We'll
            announce when Pro is live.
          </p>
        )}
      </div>
    </div>
  );
}

function Plan({
  name, price, cadence, features, featured, current, cta, comingSoon,
}: {
  name: string;
  price: string;
  cadence: string;
  features: (string | { icon: React.ReactNode; text: string })[];
  featured?: boolean;
  current?: boolean;
  cta?: React.ReactNode;
  /** Show a "Coming soon" pill in the header. Used for Pro while
   *  payments are still being set up. */
  comingSoon?: boolean;
}) {
  const base = featured
    ? "bg-ink text-bg border-ink"
    : "bg-bg text-ink border-ink/10";
  return (
    <div className={`rounded-3xl border p-6 md:p-8 ${base}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-wider opacity-70">{name}</span>
        {current && !featured && (
          <span className="text-xs px-2 h-6 inline-flex items-center rounded-full bg-ink/10">Current</span>
        )}
        {comingSoon && (
          <span className={`text-[10.5px] px-2.5 h-6 inline-flex items-center rounded-full uppercase tracking-wider font-medium ${featured ? "bg-bg/15 text-bg" : "bg-ink/10 text-ink/70"}`}>
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-serif italic text-5xl">{price}</span>
        <span className="text-sm opacity-60">{cadence}</span>
      </div>
      <ul className="mt-6 space-y-3 text-sm">
        {features.map((f, i) => {
          const icon = typeof f === "string" ? <Check size={14}/> : f.icon;
          const text = typeof f === "string" ? f : f.text;
          return (
            <li key={i} className="flex items-start gap-3">
              <span className={"mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center " + (featured ? "bg-bg/15" : "bg-ink/5")}>
                {icon}
              </span>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
      {cta && <div className="mt-8">{cta}</div>}
    </div>
  );
}

function ManagePro({
  sub, onCancel, onBack,
}: {
  sub: ReturnType<typeof useApp>["subscription"];
  onCancel: () => void;
  onBack: () => void;
}) {
  const renews = sub.renewsAt ? new Date(sub.renewsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="min-h-full">
      <ScreenHeader title="My subscription" onBack={onBack} />

      <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 md:py-10">
        <div className="rounded-3xl bg-ink text-bg p-8">
          <div className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-bg/15 text-xs">
            <Sparkles size={12} />
            Pro — active
          </div>
          <h2 className="mt-4 font-serif italic text-4xl">Thanks for supporting us.</h2>
          <p className="mt-2 text-bg/70">Unlimited AI, voice, uploads, priority matching.</p>
        </div>

        <div className="mt-6 rounded-2xl border border-ink/10 divide-y divide-ink/10">
          <Row label="Plan" value="Pro — JD 3.99 / month" />
          <Row label="Renews on" value={renews} />
          <Row label="Payment method" value={`Visa ·· ${sub.paymentLast4 ?? "0000"}`} />
          <Row label="Billing email" value="you@uni.edu.eg" />
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button className="h-12 rounded-full border border-ink/15 text-ink font-medium hover:bg-ink/5 transition">
            Update payment method
          </button>
          <button
            onClick={onCancel}
            className="h-12 rounded-full text-ink/60 hover:text-ink transition text-sm"
          >
            Cancel subscription
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <span className="text-sm text-ink/60">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
