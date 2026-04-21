# Bas Udrus — Redesign Research

**Branch:** `redesign`  •  **Status:** in progress  •  **Quality bar:** the "damn" test on first open (MacBook AND iPhone)

---

## 1. Current product — what exists today

Single monolithic `src/pages/BasUdrus.tsx` (~3,600 lines) orchestrates six top-level tab screens, plus auth and onboarding. The feature modules under `src/features/` hold the data logic, but the UI is inline-styled JSX in the monolith.

### Screens + what users do there

| Tab | What users do | Key data flows |
|---|---|---|
| **Landing** (unauth) | See the pitch, sign up / log in | — |
| **Auth** | Email/password signup or sign-in, Google OAuth, password reset | `supabase.auth.signUp` / `signInWithPassword` / `signInWithOAuth` |
| **Onboard** | 2-step wizard: uni → major → year, then meet preference + optional bio | Upserts `profiles` row |
| **Discover** | Browse a swipe-deck of help requests, filter by uni/major/course/meet type, connect or dismiss, post your own | `help_requests` + `profiles` + `connections` |
| **Connect** | Inbox of matched partners (new match hint, unread badge, per-partner sort by oldest-unreplied), open a DM (text/voice/image/file), schedule a session | `messages` realtime + `connections` + `/api/notify/message` |
| **Rooms** | Create / join study rooms (host, spots, date/time, online link or campus location), view members (host-only) | `group_rooms` + `group_members` |
| **AI** | 4 cards: Ustaz (tutor), Noor (wellbeing), Match (AI scoring), Plan (streaming study planner) | `/api/ai/*` |
| **Profile (Me)** | Edit profile, photo upload, see history, reports, post deletion | `profiles` + `subject_history` |
| **Admin** (me only) | Reports, analytics, user list | admin-only RLS |

### Always-visible shell
- Top nav (desktop): logo, tab bar, notifications bell, avatar
- Bottom nav (mobile): 5 tab icons
- Realtime: message + notification subscriptions, unread counters everywhere
- Dark mode toggle (system + manual)
- English + Arabic (RTL not yet fully native)
- Pomodoro timer is embedded in the AI surface

### Tech stack (already installed — inventory)
Everything needed for a premium build is already in `package.json`:
- React 19 + Vite
- **Tailwind v4** (`@tailwindcss/vite`)
- **Radix UI** — every primitive (dialog, popover, dropdown, tabs, tooltip, etc.)
- **framer-motion** ^12
- **lucide-react** (proper icons — currently unused, screens use emoji)
- **cmdk** (command palette — unused)
- `class-variance-authority`, `clsx`, `embla-carousel-react`, `input-otp`, `sonner`, `vaul` (drawer)

This means the redesign is **component-level, not dependency-level**. We have the primitives; we need to assemble them with taste.

---

## 2. Design direction — references + what we're borrowing

The goal is "this looks like a real product a design-led company shipped," not "AI pasted Tailwind on a Replit repo." Picking 5 references for explicit inspiration:

### Linear — precision & restraint
**Borrowing:** their typography hierarchy (single strong display face, generous line-height, understated body), their hover states (surfaces lift 1px with a 12ms timing — not 300ms bounces), their dark mode (deep blues not pure blacks).

### Arc Browser — bento boards on desktop
**Borrowing:** the home screen as a personal dashboard of tiles instead of a feed. Our Home for signed-in users becomes: "ask Ustaz" hero card (left column 2/3 width), "your day" column (right 1/3: today's unread messages, upcoming room, one suggested match, Pomodoro quick-start). Desktop earns its width.

### Partiful — editorial warmth
**Borrowing:** mixing a serif for marquee text with sans for everything else (we already load Plus Jakarta Sans + Instrument Serif — the app currently uses neither consciously). Display headings in `Instrument Serif` italic for Home, AI hero, empty states. Body + UI in `Plus Jakarta Sans`.

### Perplexity / Claude.ai — AI as primary surface
**Borrowing:** the always-visible prompt bar. Our Home, AI hub, and even Discover get a "Ask Ustaz" input right at the top — one tap away from answers about your course, regardless of where you are. A persistent floating AI FAB on every screen (bottom-right desktop, above bottom-nav mobile), collapsible into a bottom sheet on mobile (`vaul`) or a side panel on desktop (Radix Dialog with inset positioning).

### Duolingo — tactile micro-interactions without childishness
**Borrowing:** buttons have depth (2px `border-bottom` that collapses on active press — we have this already in `.btn-primary` but it's understated). Tap targets feel physical. Voice messages pulse while recording. Match cards "lift" not just highlight on hover. Pomodoro uses an orbital ring animation.

### Not borrowing from any of these
- Linear's monochrome — Bas Udrus is a community app and needs warmth
- Duolingo's 3D blob illustrations — too childish for university students
- Partiful's playful cursor — too gimmicky

---

## 3. Design system proposal

### 3.1 Palette extension

Current palette is defined in `src/lib/constants.ts` as `LIGHT` / `DARK` objects consumed via `T` prop everywhere. **Preserve the semantic tokens**, extend with:

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--surface-0` | `#F5F4F0` | `#0D1117` | Page background (warm off-white, not pure) |
| `--surface-1` | `#FFFFFF` | `#161B22` | Cards, elevated surfaces |
| `--surface-2` | `#FAFAF7` | `#1C2230` | Secondary cards, empty states |
| `--surface-glass` | `rgba(255,255,255,0.72)` | `rgba(22,27,34,0.72)` | Glass-bg backdrop-blur nav + sheets |
| `--accent` | `#4A7CF7` | `#6B9CFF` | Primary CTA, links, focus rings |
| `--accent-ink` | `#0C1F4D` | `#CBD5FF` | Accent on surfaces |
| `--ink` | `#0F1B2D` | `#F0F6FF` | Heading text (high contrast) |
| `--ink-2` | `#3D4A5C` | `#A0AAB5` | Body text |
| `--ink-3` | `#5A6370` | `#9CA4AD` | Meta text |
| `--line` | `#EAEAEA` | `#21262D` | Hairlines |
| `--success` / `--warn` / `--danger` | existing green/gold/red | existing | Statuses |
| **NEW `--ai-tutor`** | `#4F46E5 → #6366F1` | same | Ustaz brand gradient |
| **NEW `--ai-wellbeing`** | `#059669 → #10B981` | same | Noor brand gradient |
| **NEW `--ai-match`** | `#7C3AED → #8B5CF6` | same | Match brand gradient |
| **NEW `--ai-plan`** | `#DC2626 → #EF4444` | same | Plan brand gradient |

The four AI gradients exist in the current app but are inline-string-interpolated. They become CSS custom properties on `:root` so we can drive depth effects (soft-colored shadows, ring-glows) without re-typing them.

### 3.2 Typography scale

Two families, intentional use only:

- **Body / UI:** `Plus Jakarta Sans`, 400/500/600/700 — 12 / 13 / 14 / 15 / 16 / 18 / 20
- **Display:** `Instrument Serif` italic, only for marquee headings: home hero ("Good afternoon, Ahmed"), AI-hub hero, empty-state titles, and empty-inbox illustrations. Sizes 32 / 44 / 56.

Rule: **if Instrument Serif appears in UI chrome (buttons, tabs, form labels), it's wrong.** It's for editorial moments only.

### 3.3 Spacing + radius

- Base unit: 4px (Tailwind default).
- Surface radius scale: `sm 10 / md 14 / lg 18 / xl 22 / 2xl 28` — current app uses 12/13/14/16/18/20/22/24/26 ad-hoc; normalize.
- Card padding: `lg (18px)` on mobile, `2xl (28px)` on desktop.

### 3.4 Depth / shadow scale

Apple-level is earned through **layered shadows**, not one `0 4px 12px`. Three-stop shadows:

```css
--shadow-sm:  0 1px 2px rgba(15,27,45,.04), 0 1px 1px rgba(15,27,45,.03);
--shadow-md:  0 4px 8px -1px rgba(15,27,45,.08), 0 2px 4px -1px rgba(15,27,45,.04), 0 0 0 1px rgba(15,27,45,.03);
--shadow-lg:  0 12px 24px -4px rgba(15,27,45,.10), 0 6px 12px -4px rgba(15,27,45,.06), 0 0 0 1px rgba(15,27,45,.04);
--shadow-xl:  0 24px 48px -12px rgba(15,27,45,.18), 0 12px 24px -8px rgba(15,27,45,.10), 0 0 0 1px rgba(15,27,45,.05);
--shadow-ai-tutor: 0 12px 40px -8px rgba(99,102,241,.30), 0 6px 16px -4px rgba(99,102,241,.18);
```

Dark-mode variants drop the inset 1px border ring (already low-contrast in dark) and multiply the blur alpha.

### 3.5 Motion principles (framer-motion)

- **Default ease:** `cubic-bezier(0.25, 0.8, 0.25, 1)` (already used in current CSS — keep). Call it `easeBasOut`.
- **Duration tokens:** `fast: 150ms`, `base: 220ms`, `slow: 380ms`, `hero: 560ms`.
- **Shared transitions:** page-swap uses shared layoutId on avatar/card when navigating from Discover to profile, rooms card to members modal. Opens feel connected, not teleported.
- **Reduce motion:** honor `prefers-reduced-motion` globally (currently only touches animations, not framer — need `MotionConfig reducedMotion="user"`).

### 3.6 Icons

**Emojis are out of the UI chrome** (they stay in user content — bios, messages, AI responses where cultural warmth matters). Every tab, button, filter, and header uses **lucide-react**. Example mapping:

- 🔍 Discover → `Compass`
- 💬 Connect → `MessageCircle`
- 🎓 Rooms → `Users` (or `BookOpen`)
- 🤖 AI → `Sparkles`
- 👤 Me → `User`
- 🛡️ Admin → `Shield`
- 🔔 bell → `Bell`
- 🎥 online meet → `Video`
- 📍 face meet → `MapPin`

---

## 4. AI-forward information architecture

Currently AI is tab #4 of 5. Students don't find it. The 14-user/48-hour AI usage data proves this.

### Proposed: AI is ambient, not a tab.

1. **Home screen (new, logged-in default)** replaces "Discover is the landing screen." Home is a bento dashboard with Ustaz as the hero tile.
2. **Persistent Ask-Ustaz bar**: lives in the shell top-bar on every screen ("Ask about anything — e.g. 'explain recursion'"). On mobile it collapses into the persistent AI FAB above the bottom nav.
3. **Inline AI chips** on Discover cards ("Ask Ustaz about this topic"), on Rooms ("Generate a study plan for this session"), on Profile ("AI feedback on your bio").
4. **Keep the AI tab** as the deep-dive surface (long chats, conversation memory, saved plans).
5. Pomodoro moves into a **floating pill** that follows you across tabs once started (not buried in AI).

### New top-level tab layout

Desktop (sidebar, not top bar):
```
[ Home ]       (new)
[ Discover ]
[ Connect ]
[ Rooms ]
[ Ask Ustaz ]  (AI hub — larger icon)
────────
[ Me ]
[ Admin ]      (if admin)
```
Mobile (bottom nav — 5 slots, same order minus Admin and minus Home when at root):
```
[ Home | Discover | Ask | Connect | Me ]
```

---

## 5. RTL + bilingual

Current state: Arabic renders LTR because `<html lang="en">` is hardcoded. Needs:

1. Toggle `dir="rtl"` on `<html>` when the user's Arabic toggle is on, in App shell.
2. Use CSS logical properties (`padding-inline-start` instead of `padding-left`) — Tailwind v4 supports this natively (`ps-4` instead of `pl-4`).
3. All asymmetric layouts use `rtl:` variant for mirror flips.
4. Don't mirror icons that have intrinsic direction (play icon stays as-is, but chevron-left becomes chevron-right in RTL).

---

## 6. What WILL change vs. what WON'T

### CHANGES (UI / shell)
- Every screen gets a new layout + component library (Radix + custom)
- Emojis removed from UI chrome (stay in user content)
- Desktop uses bento / multi-column layouts
- Mobile gets native-feeling drawers (`vaul`), command palette (`cmdk`)
- AI gets a persistent hero surface (new Home, Ask-bar in shell, FAB)
- Typography mixes Plus Jakarta + Instrument Serif intentionally
- Motion is systematized (framer-motion variants, not inline transitions)
- Icons via `lucide-react`

### PRESERVED (data + behavior)
- All feature-module hooks (`useMessages`, `useRooms`, `useDiscover`, `useAI`, `useNotifications`, `useProfile`, `useAuth`, `useAdmin`)
- All `/api/*` endpoints (just security-hardened — don't touch)
- All RLS policies + RPCs
- All realtime subscriptions
- `src/context/AppContext.tsx` public API (only add values)
- `src/services/*` (only add exports)
- Auth flow — signup/signin/OAuth/reset/onboarding order
- Dark mode behavior
- Connection / messaging / notification semantics
- Posting help-requests logic
- Rooms host/members logic
- AI streaming flows
- Pomodoro state
- Admin panel access

### DEFERRED (next redesign session, not blocking first ship)
- RTL full-polish (get it working, not perfected)
- Command palette (hook up `cmdk` — stubbed in shell, wired later)
- Onboarding illustrations (first ship uses typography only)
- Celebratory moments (streak-7, badge-earned — current confetti stays; full rework later)

---

## 7. Supabase branch — cost deferred

Creating a Supabase preview branch requires cost confirmation. Since this redesign is **UI-only** (none of the `HARD CONSTRAINTS` are being touched — schema, RLS, RPCs all stay), we proceed against main DB on the redesign preview.

**If schema changes become necessary**, we'll create the branch at that point and flag the env vars needed in Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` swapped for branch credentials).

---

## 8. Quality gate — what "damn" means in code

Before each screen ships:

- [ ] `pnpm build` passes (plus type-check)
- [ ] Open on 1440px viewport: uses the real estate (no 600px column with 800px of whitespace either side)
- [ ] Open on 390px viewport: all CTAs in thumb zone, nothing clipped
- [ ] Open in RTL: layout mirrors correctly (no right-aligned text in LTR-only containers)
- [ ] Open in dark mode: every surface has a dark variant, no light-mode-only shadows bleeding through
- [ ] Turn JS off: pre-hydration HTML shows meaningful copy (already shipped in `index.html` — keep)
- [ ] Every animation can justify its existence (list the purpose; if you can't, remove it)
- [ ] No inline `style={}` objects bigger than 3 properties — anything else becomes a utility class or component

Written as a checklist in every PR description.
