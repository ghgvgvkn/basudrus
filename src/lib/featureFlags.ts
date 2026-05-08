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

/** Specific auth.user.id values that auto-receive Pro tier on sign-in
 *  regardless of PAYMENTS_LIVE. Used to give the founder + a small
 *  set of trusted testers full Pro access for testing without
 *  flipping the global payment gate.
 *
 *  These users see the Pro UI, get unlimited AI quota, can use Pro-
 *  gated features (voice messages, etc.) — exactly as if they had
 *  paid. Everyone else still sees the "Coming soon" Pro card.
 *
 *  DO NOT add a user here unless they are testing the product and
 *  you trust them. This list is shipped in the public bundle. */
export const PRO_OVERRIDE_USER_IDS: readonly string[] = [
  // Ahmed Al Dulaimi — founder. All known signup emails.
  "23a1bd67-2113-40c1-be19-e14aaecfc381", // ahmedfahad9000@gmail.com (PSUT)
  "8e9400ed-359d-4b25-9a88-c5c5d9efe236", // basudrusjo@gmail.com (PSUT)
  "551230d5-fe14-4f74-afb0-756db837fcd2", // a7medaldulaimi@icloud.com
  "5ccb365b-4376-4513-928f-8551d86a6f08", // ahmedfahad9000@gmail.c (test signup)
  "8547f447-ee4f-46ac-8fb7-6b2484c56801", // ahmedfahad9@ytjtk.ghhkj (test signup)
];

/** True if the given auth user id should auto-receive Pro tier. */
export function isProOverrideUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return PRO_OVERRIDE_USER_IDS.includes(userId);
}
