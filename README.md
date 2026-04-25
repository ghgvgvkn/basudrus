# bondu — redesign bundle (iteration 2)

A Vite + React + Tailwind v4 bundle of the bondu redesign, ready to be
dropped into the live repo one slice at a time.

## Run

```bash
npm install
npm run dev
```

Everything mocks. No Supabase connection, no network calls. `DEMO_PROFILE`
in `src/context/AppContext.tsx` seeds the UI. Quota + subscription +
onboarding persist to `localStorage` keys prefixed `bu:`.

---

## What shipped in iteration 2

| Area              | What changed                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Naming**        | "Ustaz" → **AI (Omar)**. Added second persona **AI (Noor)** for mental-health / companion mode. Exposed as a segmented toggle in the AI header.     |
| **AI Screen**     | Full-bleed chat. Dropped the WebGL hero. Minimal empty state (serif-italic greeting + 2 prompt pills). Quota chip. File upload. Study-plan artifact. |
| **Per-message 3D** | Every AI reply gets its own WebGL-rendered scene cached as a data URL. Rendered once, seeded by message ID. See `features/ai/messageBg.ts`.         |
| **Subscription**  | `AppContext.subscription` with `{tier, aiQuota, aiCap, resetsAt}`. Free = 30 msgs/day. Pro = ∞. Full upgrade + manage screens.                        |
| **Onboarding**    | 4-step first-run: welcome → university/major/year → 5-axis personality quiz → done. Gated by `onboardingComplete` in `App.tsx`.                     |
| **Voice messages**| Hold-to-record mic button in ConnectScreen composer, live waveform, swipe-left to cancel. Playback bubble with tap-to-play + per-bar progress.      |
| **File uploads**  | Pro-gated attachments in ConnectScreen and AI. Composer shows file chip, strips on send.                                                            |
| **Profile**       | Added Upgrade-to-Pro card (free tier) / Manage-subscription card (pro tier).                                                                        |

---

## File-level map

```
src/
├─ App.tsx                           ← Gate { Onboarding → Shell<Router> }
├─ context/
│  ├─ AppContext.tsx                 ← + subscription, onboarding, personality
│  └─ LocaleContext.tsx              ← Ustaz strings removed; AI (Omar) labels
├─ shared/types.ts                   ← + Subscription, PersonalityAnswers,
│                                       AIMessage, AIConversation, StudyPlanArtifact
├─ features/
│  ├─ ai/
│  │  ├─ AIScreen.tsx                ← full rewrite (persona toggle, quota, 3D bg)
│  │  ├─ messageBg.ts                ← Three.js per-message scene renderer
│  │  └─ studyPlanArtifact.tsx       ← schedule-grid renderer
│  ├─ messaging/ConnectScreen.tsx    ← voice + file attachments
│  ├─ subscription/SubscriptionScreen.tsx   ← upgrade + manage Pro
│  ├─ onboarding/OnboardingScreen.tsx       ← 4-step first-run
│  ├─ profile/ProfileScreen.tsx      ← + Pro card
│  ├─ home/HomeScreen.tsx            ← copy: "Ask Omar"
│  └─ discover/DiscoverScreen.tsx    ← copy: "Why Omar picked them"
└─ components/shell/
   ├─ Sidebar.tsx, MobileNav.tsx     ← renamed Ustaz → AI
   ├─ CommandPalette.tsx             ← renamed AskUstazRow → AskOmarRow
   └─ ScreenHeader.tsx (new)         ← sticky back+title for secondary screens
```

---

## Per-message 3D artifacts — how it works

`features/ai/messageBg.ts#renderMessageBg(id, persona)`

1. Hash the message ID to a deterministic seed (0..1).
2. Spin up a one-shot Three.js WebGL renderer with an
   `IcosahedronGeometry` + custom shader (simplex noise displaces the
   vertices; hue interpolates between persona colours).
3. Render one frame into an offscreen canvas sized 640×400.
4. Snapshot `canvas.toDataURL("image/png")`, cache by `id+persona`.
5. Dispose geometry + material + renderer immediately. The GPU context
   is not kept alive.
6. The component renders the data URL as a plain `<img>`, with a
   gradient overlay for text legibility.

Palette:

- **Omar**: violet → indigo (#5B4BF5 → #8A5CF7)
- **Noor**: teal → sage  (#0E8A6B → #3BC79E)

Fallback: `fallbackGradient(id, persona)` returns a CSS gradient string
for browsers without WebGL.

Long threads stay cheap — N messages = N PNG data URLs in memory, zero
per-frame rendering.

---

## Subscription model

```ts
// shared/types.ts
export interface Subscription {
  tier: "free" | "pro";
  aiQuota: number;   // messages remaining today (free) or Infinity (pro)
  aiCap:   number;   // 30 (free) or Infinity (pro)
  resetsAt: string;  // ISO — next midnight for free-tier reset
  renewsAt?: string; // Pro only
  paymentLast4?: string;
}
```

- `consumeAIMessage()` — decrements quota, returns false if capped.
- `upgradeToPro()` — demo: sets tier = "pro", renewsAt = +30d, card 4242.
- `cancelPro()` — rolls back to free.

Persisted to `localStorage["bu:sub"]`. On load, if `resetsAt` is in the
past, the free-tier bucket refills automatically.

---

## Porting to the live repo

### 1. Rename + route the new surfaces

| Bundle screen string | Suggested route            | Notes                                     |
| -------------------- | -------------------------- | ----------------------------------------- |
| `"ai"`               | `/ai` (existing `/ustaz`)  | Redirect old path → new. Keep deep-linked |
| `"subscription"`     | `/settings/subscription`   | New.                                      |
| `"onboarding"`       | `/onboarding`              | Gate at shell root in live router.        |

### 2. Replace the mock AI loop

`AIScreen.tsx#fakeReply()` is a switch on keywords. Swap for the existing
`useAI()` hook. The response shape `{ id, role, persona, body, artifact? }`
is already compatible with Vercel AI-SDK streamed responses — map each
delta to a partial `AIMessage`.

### 3. Wire subscription to Paddle / Stripe

- Replace `upgradeToPro()` with a call that opens Paddle Checkout
  (or creates a Stripe session) for the plan SKU.
- Add a `profile_subscriptions` table in Supabase; let the webhook
  populate `tier`, `renewsAt`, `payment_last4`.
- Replace `localStorage["bu:sub"]` reads/writes with a realtime
  subscription to that row.

### 4. Onboarding → server

- Add `profiles.personality JSONB`, `profiles.onboarded BOOLEAN`.
- In `completeOnboarding()`, upsert both, then fall through to the app.
- Matching should read `profiles.personality` and weight it into
  Discover's score (pair similar-pace, compatible schedule).

### 5. Voice messages → real audio

`ConnectScreen#Composer` simulates the recorder. To make it real:

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const rec = new MediaRecorder(stream);
// onstart → tick waveform from AnalyserNode + AudioContext
// onstop  → blob → upload to storage → post msg with url + duration
```

Waveform downsampling: on stop, run the AudioBuffer through 42 evenly
spaced RMS windows to match the bar count in `VoiceBubble`.

---

## SQL migrations (needed for the live port)

```sql
-- 1. Personality + onboarding
alter table profiles
  add column if not exists personality  jsonb,
  add column if not exists onboarded    boolean not null default false;

-- 2. Subscriptions
create table if not exists profile_subscriptions (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  tier          text not null check (tier in ('free','pro')),
  ai_quota      int  not null default 30,
  ai_cap        int  not null default 30,
  resets_at     timestamptz not null,
  renews_at     timestamptz,
  payment_last4 text,
  updated_at    timestamptz not null default now()
);

-- 3. AI conversations + messages (if not already modeled this way)
create table if not exists ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  persona    text not null check (persona in ('omar','noor')),
  created_at timestamptz not null default now()
);

create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','ai')),
  persona         text not null check (persona in ('omar','noor')),
  body            text not null,
  artifact        jsonb,
  attachment      jsonb,
  created_at      timestamptz not null default now()
);

-- 4. Voice messages
alter table messages
  add column if not exists kind          text not null default 'text'
    check (kind in ('text','voice','file')),
  add column if not exists audio_url     text,
  add column if not exists duration_ms   int,
  add column if not exists waveform      int[];  -- downsampled 0..100
```

RLS: each table's `profile_id` must equal `auth.uid()` on select/insert/update.

---

## Known gaps / next iteration

- Chat history drawer on the AI screen (per-thread sidebar). Context
  keeps a `conversations` array ready; drawer component not built.
- Drag-to-reschedule on the study-plan artifact.
- Share AI responses as OG cards (would reuse `renderMessageBg` server-side).
- Real mic permission UX (currently skipped — pointer events only).
- I18n strings for Arabic on the new AI / Subscription / Onboarding screens
  (only EN is fully populated).

---

## Legacy → redesign rename cheat-sheet

| Legacy name          | New name          |
| -------------------- | ----------------- |
| Ustaz                | AI (Omar)         |
| *(new)*              | AI (Noor)         |
| `AIMode` enum        | `AIPersona` union |
| `AskUstazRow`        | `AskOmarRow`      |
| `--shadow-ustaz`     | `--shadow-ai`     |

Internal CSS var `--g-ustaz` is still present in `index.css` — the
per-message 3D path doesn't use it. Leave until the gradient system
is consolidated in iteration 3.
