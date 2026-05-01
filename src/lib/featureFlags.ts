/**
 * Feature flags — small constants that gate features still in setup.
 *
 * Keep this file tiny. Each flag should:
 *   - Default to OFF (false) so a fresh deploy never accidentally
 *     opens an unfinished feature.
 *   - Be a single-source-of-truth boolean — every gate in the app
 *     reads from here, so the founder flips ONE line and the
 *     feature lights up everywhere.
 *
 * When we wire real billing (Paddle / Lemon Squeezy / Stripe) we'll
 * either:
 *   (a) flip PAYMENTS_LIVE to true here, or
 *   (b) replace this constant with a runtime read from a
 *       feature-flags table / env var. Until then, this file IS
 *       the kill-switch.
 */

/** True ONLY when a real payment processor is wired up and webhook-
 *  driven Pro subscriptions are flowing. While false:
 *    - SubscriptionScreen disables the "Upgrade — JD 3.99 / mo"
 *      button and shows a "Coming soon" state instead.
 *    - AppContext.upgradeToPro becomes a no-op (defence-in-depth so
 *      no other code path can flip a user to Pro for free).
 *    - The Pro plan card stays visible and beautifully designed —
 *      students see what's coming, they just can't trigger it yet.
 *  Existing Pro users (anyone whose localStorage says tier=pro from
 *  before we shipped this gate) keep their state untouched. */
export const PAYMENTS_LIVE = false;
