# Bas Udrus — iOS / Android app

A real native client for basudrus.com. Same Supabase, same `/api/*`
endpoints, native UI built with Expo + React Native.

**Not a WebView.** Real native screens, native gestures, native haptics,
native blurred tab bar.

## First-time setup

```bash
cd mobile
npm install          # installs Expo + RN deps into mobile/node_modules
npx expo prebuild --clean   # only needed if you ever want to add native modules outside Expo
```

You do NOT need Xcode to develop. You only need it once when you want to
build a real `.ipa` file to put on the App Store — and even then we'll
use EAS Build (cloud) so Xcode stays unopened.

## Running on your phone (recommended for daily dev)

1. Install **Expo Go** from the App Store on your iPhone.
2. From `mobile/`, run:
   ```bash
   npm start
   ```
3. Scan the QR code with your iPhone camera. The app boots in Expo Go.
4. Every code save hot-reloads on the device. Shake the phone for the dev
   menu (reload, toggle Fast Refresh, etc).

> Expo Go can run anything except custom native modules. Our app uses
> only Expo-blessed modules (haptics, blur, gestures, reanimated,
> async-storage, secure-store, status-bar, supabase-js), so Expo Go
> handles 100% of it.

## Running on the iOS Simulator (no phone needed)

1. Install Xcode from the Mac App Store once (you can ignore it after).
2. From `mobile/`:
   ```bash
   npm run ios
   ```
3. The simulator boots and the app installs automatically.

## Building a real iOS app (.ipa for TestFlight / App Store)

We use **EAS Build** — Expo's cloud build service. You never open Xcode.

```bash
npm install -g eas-cli
eas login                           # use your Expo account
eas build:configure                 # one-time setup, creates eas.json
npm run build:preview               # builds a TestFlight-ready .ipa in the cloud
```

When it's done EAS gives you a download link AND can submit directly to
TestFlight with:

```bash
npm run submit:ios
```

## Where things live

```
mobile/
├── app/                    # File-based routes (Expo Router, like Next.js)
│   ├── _layout.tsx         # Root: providers + auth gate
│   ├── index.tsx           # Splash placeholder
│   ├── (auth)/             # Routes for signed-out users
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx
│   └── (tabs)/             # Routes for signed-in users
│       ├── _layout.tsx     # The bottom tab bar (blurred)
│       ├── index.tsx       # Home tab
│       ├── ai.tsx          # Tony / AI tab
│       └── profile.tsx     # Profile tab
│
├── src/
│   ├── components/         # Reusable UI (Card, PrimaryButton, ScreenHeader)
│   ├── context/            # AuthContext
│   └── lib/                # supabase, api, theme, haptics
│
├── assets/                 # icon.png, splash.png (TODO: drop your art here)
├── app.json                # Expo config (bundle id, scheme, plugins)
├── babel.config.js
├── metro.config.js
├── package.json
└── tsconfig.json
```

## What's wired in v1

- **Auth:** sign in / sign up with email + password, persisted in
  AsyncStorage via the Supabase client.
- **Three tabs:** Home (dashboard), Tony (AI tutor — POSTs to
  `/api/ai/tutor`), Profile (read-only + sign out).
- **Native feel:** Taptic-engine haptics on every tap, scale-on-press
  animation on buttons + cards, blurred floating tab bar on iOS,
  pull-to-refresh on Home + Profile, keyboard-avoiding composer on AI.

## What's NOT in v1 (next pushes)

- Voice mode (will use `expo-av` + same `/api/ai/aurora` endpoint)
- Real-time messaging (will use Supabase Realtime; already in the web app)
- Past papers list + viewer
- Push notifications (`expo-notifications` + Supabase function)
- Onboarding flow (uni/major/year picker)
- Apple Sign In (`expo-apple-authentication` — required by App Store
  guideline 4.8 once we add any other social sign-in)

## Why these choices

- **Expo over bare React Native:** EAS Build means cloud-builds without
  Xcode. Expo Go means dev on your real device in 30 seconds. The Expo
  SDK gives us battle-tested wrappers for haptics, blur, secure-store,
  splash, status-bar — all the stuff you'd otherwise wire by hand.
- **Expo Router over React Navigation:** File-based routing feels like
  Next.js, gives us automatic deep-link support, and the typed-routes
  experiment means `router.push('/(tabs)/ai')` is a compile error if
  you typo it.
- **No UI library (NativeBase / Tamagui / GlueStack):** Zero extra MB
  in the bundle, total control of the JARVIS-adjacent aesthetic, and
  no fight with a library when we add audio-reactive glows later.
- **Outside the pnpm workspace:** Metro bundler trips on pnpm's
  symlinked node_modules. `mobile/` keeps its own flat `node_modules`
  so cold starts are fast and `pnpm install` at the root doesn't
  smash this app.
