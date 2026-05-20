/**
 * SubscriptionSection — current plan, what each tier unlocks, Sparks balance.
 *
 * IMPORTANT: billing isn't wired to Stripe yet. We surface the planned
 * tier structure honestly ("Coming soon" on the upgrade buttons) instead
 * of faking a billing flow that errors out at checkout. The plan is
 * locked in the master strategy doc — Free / Student Pro $7 / Studio $25.
 *
 * When Stripe goes live the only file that needs to change is this one
 * (swap the disabled buttons for `<a href="/api/checkout?tier=...">`).
 */
import { Check, Sparkles, Zap, Crown } from "lucide-react";
import { Group, Tag, Note } from "./parts";

interface Tier {
  id: "free" | "student_pro" | "studio";
  name: string;
  price: string;
  annual: string;
  audience: string;
  features: string[];
  highlight?: boolean;
  icon: typeof Sparkles;
}

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    annual: "Forever",
    audience: "Try the AI",
    icon: Sparkles,
    features: [
      "30 messages/day with Tony Starrk + Sherlock",
      "All artifacts (study plan, professor email, CV)",
      "Memory + proactive greeting",
      "View 3D models",
      "10 Sparks / month",
    ],
  },
  {
    id: "student_pro",
    name: "Student Pro",
    price: "$7/mo",
    annual: "or $60/year",
    audience: "Serious students",
    icon: Zap,
    highlight: true,
    features: [
      "Unlimited Tony + Sherlock",
      "Cooked 2.3 + Cooking 2.9 models",
      "Generate 5 3D models / month",
      "Priority Auto routing",
      "50 Sparks / month",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: "$25/mo",
    annual: "or $240/year",
    audience: "Power users",
    icon: Crown,
    features: [
      "Everything in Student Pro",
      "Concierge Mode (calendar + email drafts)",
      "Generate 50 3D models / month",
      "Early access to new features",
      "500 Sparks / month",
      "Priority support",
    ],
  },
];

// TODO(billing): read from profiles.subscription_tier when Stripe is wired.
// For now every user is on Free.
const CURRENT_TIER: Tier["id"] = "free";
const SPARKS_BALANCE = 10;
const SPARKS_RESET_DATE = "1st of next month";

export function SubscriptionSection() {
  return (
    <>
      <Group title="Current plan">
        <div className="px-4 py-3.5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-1 font-medium">
                {TIERS.find((t) => t.id === CURRENT_TIER)?.name}
              </span>
              <Tag tone="accent">Active</Tag>
            </div>
            <div className="text-xs text-ink-3 mt-0.5">No billing on file. Upgrade anytime.</div>
          </div>
        </div>
        <div className="px-4 py-3.5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink-1 font-medium">Sparks balance</div>
            <div className="text-xs text-ink-3 mt-0.5">Used for premium compute — 3D generation, deep research, long artifacts</div>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-lg font-semibold text-ink-1 inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-accent" />
              {SPARKS_BALANCE}
            </div>
            <div className="text-[10px] text-ink-3 uppercase tracking-wider">Refills {SPARKS_RESET_DATE}</div>
          </div>
        </div>
      </Group>

      <Group title="All plans">
        <div className="grid sm:grid-cols-3 gap-3 p-3">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            const isCurrent = tier.id === CURRENT_TIER;
            return (
              <div
                key={tier.id}
                className={
                  "rounded-xl p-4 border bg-surface-1 flex flex-col " +
                  (tier.highlight ? "border-accent/50 shadow-sm" : "border-line/60")
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon className="h-5 w-5 text-accent" />
                  {tier.highlight && <Tag tone="accent">Most popular</Tag>}
                </div>
                <div className="text-sm font-semibold text-ink-1">{tier.name}</div>
                <div className="text-[11px] text-ink-3 mb-2">{tier.audience}</div>
                <div className="text-xl font-bold text-ink-1">{tier.price}</div>
                <div className="text-[11px] text-ink-3 mb-3">{tier.annual}</div>
                <ul className="space-y-1.5 text-xs text-ink-2 flex-1 mb-3">
                  {tier.features.map((f, i) => (
                    <li key={i} className="flex gap-1.5">
                      <Check className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="h-9 grid place-items-center rounded-full bg-surface-2 text-xs text-ink-3 font-medium">
                    Current plan
                  </div>
                ) : (
                  <button
                    disabled
                    className="h-9 rounded-full bg-ink-1/10 text-ink-3 text-xs font-medium cursor-not-allowed"
                    title="Stripe checkout launches with Phase 5 — pricing live alongside the Sparks rebrand"
                  >
                    Coming soon
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Group>

      <Group title="Billing">
        <div className="px-4 py-3.5">
          <div className="text-sm text-ink-1">No billing history yet</div>
          <div className="text-xs text-ink-3 mt-1">Invoices and receipts will appear here once you subscribe.</div>
        </div>
      </Group>

      <Note tone="info">
        Subscriptions are shared between basudrus.com and ai.basudrus.com. Pay once, use both.
      </Note>
    </>
  );
}
