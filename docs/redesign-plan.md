# Bas Udrus — Redesign Build Plan

Screen-by-screen build order with preservation flags, ROI ranking, and what changes.

Companion to `redesign-research.md`. Don't read this without reading that first.

---

## 0. Foundation (ships before any screen)

### 0a. Design tokens → `src/lib/design-tokens.ts` + `src/index.css`
- Port `LIGHT` / `DARK` from `src/lib/constants.ts` into CSS custom properties on `:root[data-theme="light"|"dark"]`
- Add the four AI-brand gradients as custom properties
- Add 4-step shadow scale + AI-tutor/ai-wellbeing/ai-match/ai-plan shadow variants
- Keep `LIGHT` / `DARK` exports from `constants.ts` (preservation — old code uses the `T` prop)

### 0b. Motion system → `src/shared/motion.ts`
- `MotionConfig reducedMotion="user"` wrapped in App
- Reusable variants:
  - `fadeIn` / `fadeInUp` / `slideIn`
  - `cardHover` (lift 2px + shadow-lg)
  - `pagePop` (opacity + scale on page-swap)
  - `staggerChildren` for feed reveals
- Duration constants: `fast/base/slow/hero`

### 0c. Base UI primitives → `src/components/ui/*`
- `Button` (variants: primary / secondary / ghost / danger / ai-tutor / ai-wellbeing) using CVA
- `Card` (variants: default / glass / elevated / bento) with proper shadow + ring on hover
- `Input` / `Textarea` / `Select` (wrapping Radix)
- `Avatar` (new, uses the existing `UserAvatar` internals but wrapped in consistent shell)
- `Badge` (status pills)
- `Sheet` (mobile drawer via vaul)
- `Sidebar` (desktop nav)
- `BottomNav` (mobile nav)
- `Icon` shim around lucide-react for sizing consistency

### 0d. Shell → `src/components/shell/Shell.tsx`
- Wraps every authenticated screen
- Desktop ≥ 1024px: sidebar left, content center, optional right column
- Mobile: content + bottom nav + floating AI FAB
- Ask-Ustaz bar in the top-bar (desktop) or collapsed into FAB (mobile)
- Notification bell + avatar menu (Radix dropdown)
- Handles the `curTab` routing without changing BasUdrus state ownership

---

## 1. Screens — build order (by ROI / visual impact)

| # | Screen | Risk | Impact | Status |
|---|---|---|---|---|
| 1 | **Home** (new, logged-in default) | 2/10 | 10/10 | 🚧 |
| 2 | **AI hub** (redesign the 4-card page + chat surface) | 3/10 | 10/10 | ⏳ |
| 3 | **Discover** (redesign feed + filters) | 5/10 | 8/10 | ⏳ |
| 4 | **Rooms** (redesign cards + host members modal) | 3/10 | 7/10 | ⏳ |
| 5 | **Connect** (redesign inbox + chat) | 6/10 | 8/10 | ⏳ |
| 6 | **Profile/Me** (redesign edit + history) | 4/10 | 6/10 | ⏳ |
| 7 | **Notifications panel** (redesign dropdown → full-page on mobile) | 2/10 | 4/10 | ⏳ |
| 8 | **Landing** (unauth — redesign hero) | 3/10 | 7/10 | ⏳ |
| 9 | **Admin** (redesign, me-only) | 2/10 | 3/10 | ⏳ |

Home + AI ship first — those are the "damn" surfaces. Discover and Rooms are the daily-driver surfaces. Connect is highest risk (realtime + media + dedup already there — don't break it).

---

## 2. Per-screen ticket — template

For each screen, every commit follows this shape:

### Screen: `<name>`
- **Route:** `curTab === "<x>"` (preserve — don't change state machine)
- **Data hooks used:** unchanged (list them)
- **What changes visually:** [bullets]
- **What stays identical in behavior:** [bullets]
- **Desktop layout:** [describe bento / sidebar split]
- **Mobile layout:** [describe thumb-zone placement]
- **New components introduced:** [list]
- **Acceptance:** self-check checklist from quality gate

---

## 3. Per-screen specs — the near-term ones

### 3.1 Home (new)
**Route:** new `curTab === "home"` — set as default screen for authenticated users (replace "discover" as default in `AppContext` / auth listener).

**Desktop bento:**
```
┌─────────────────────────────┬──────────────────┐
│  "Good afternoon, Ahmed"    │  TODAY           │
│  [Ask Ustaz — input field]  │  ├─ 2 unread     │
│   (serif hero, 44px)        │  ├─ Room at 7pm  │
│                             │  └─ 1 new match  │
│  [Quick prompts chips]      │                  │
├─────────────────────────────┤  POMODORO        │
│  CONTINUE WHERE YOU LEFT    │  [25:00 button]  │
│  • Last tutor chat          │                  │
│  • Open room                │  STREAK          │
│  • Draft help request       │  🔥 3 days       │
└─────────────────────────────┴──────────────────┘
```

**Mobile:** vertical stack — hero + ask bar → quick chips → today → continue → pomodoro → streak.

**Data:** uses `useAI` (history), `useMessages` (unreadCounts), `useRooms` (groups), `useDiscover` (allStudents for new-match suggestion).

**New components:** `HeroGreeting`, `AskBar`, `BentoTile`, `TodayStack`, `StreakChip`, `PomodoroQuickStart`.

### 3.2 AI hub (redesign)
**Route:** `curTab === "ai"` (preserve).

**4 cards → 4 bento tiles** with real depth (shadow-ai-*, colored ring on hover). Click opens the corresponding chat/flow in a full-bleed layout with a persistent back button and visible conversation memory indicator.

**Tutor chat:** messages become proper threaded cards (not flat bubbles), attached file shown as a chip, input gets a model-thinking indicator during stream.

**Wellbeing:** keep the mood chips but restyle as 2-row grid with mini-illustrations (pure CSS — no imported SVG).

### 3.3 Discover (redesign)
**Desktop:** split pane — left 2/3 is the swipe deck, right 1/3 is the active card's detail (like Gmail 3-column). Filters collapse into a single `Command` popover from `cmdk` ("Filter by…").

**Mobile:** unchanged swipe deck mechanics (don't break the gesture) but cards get the new shadow scale + better typography.

**Data:** `useDiscover` unchanged — same `allStudents`, `filteredPool`, `visibleDeck`, `handleConnect`, `handleReject`.

### 3.4 Rooms (redesign)
- Card becomes a proper event invite (serif title, date-chip, host-avatar-stack, gauge for spots filled)
- Host-only "Members" modal gets a proper sheet treatment + tap-to-message CTA (already there, just restyle)
- Desktop: 2-column grid; mobile: stacked

### 3.5 Connect (redesign — highest risk)
**Don't touch:**
- Realtime message subscription (`useMessages`)
- `partnersWithMessages` sort (oldest-unreplied first)
- `unreadCounts` + badge math
- Optimistic insert + `client_id` dedup
- File/voice/image XSS guard we just shipped (preserve `safeFileUrl` logic)
- Email notify call site

**What changes:**
- Inbox rows get proper Avatar + name + last-message preview + time + unread pill
- Chat view gets a header with uni/major chip, connection date, Pomodoro quick-start
- Message bubbles: keep colors but add softer radii, better reply-thread visual (indent if reply-to)
- Voice message: waveform preview instead of default `<audio>`
- File attachment: icon by mime-type (lucide)

### 3.6 Profile (Me)
- Hero photo + cover area (desktop)
- Tabs: Edit / Posts / History / Settings (Radix Tabs, preserved as-is for state)
- Edit form gets `react-hook-form` integration (already installed, unused)

### 3.7 Notifications
- Dropdown on desktop stays (restyled)
- Mobile: slides up as full-height sheet instead of cramped dropdown

### 3.8 Landing (unauth)
- Single long-scroll hero: display-serif headline, then bento of features, then "ask Ustaz" live demo (unauth-capped), then sign-up CTA
- Desktop: asymmetric hero with large serif left + screenshot right
- Mobile: stacked

### 3.9 Admin
- Minimal restyle — admin is me only, low ROI

---

## 4. Commit cadence + docs

- Every screen ships in 1–3 commits
- Every 3–5 commits → one line appended to `docs/redesign-progress.md`
- PR opened when all 9 screens are shipped OR when Home + AI are solid and we want a staged merge

---

## 5. Env + deploy

- Vercel auto-deploys the `redesign` branch → preview URL at `basudrus-git-redesign-ghgvgvkns-projects.vercel.app`
- Main branch stays on `basudrus.com` — users see zero change until PR merge
- Supabase main DB is the source of truth (branch deferred — see research doc §7)

---

## 6. Merge criteria

Before opening the PR:
- [ ] All 9 screens shipped at acceptable quality
- [ ] Preview URL tested on MacBook (Safari + Chrome) AND iPhone (Safari)
- [ ] RTL mode renders correctly on 3 sample screens (Home, Discover, Chat)
- [ ] Dark mode passes visual check on every screen
- [ ] `pnpm build` + type-check clean
- [ ] Auth flow tested end-to-end on preview
- [ ] Realtime (send yourself a message from another device) works on preview
- [ ] No regressions in the preservation list (§6 of research doc)

PR title: `Redesign: AI-forward, bento desktop, mobile-native`
PR body includes: changelog per screen, preview URL, MacBook + iPhone screenshots, test checklist, rollback plan (revert merge commit).
