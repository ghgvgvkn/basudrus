/**
 * AI tab — Tony Starrk / Sherlock, redesigned to match the website.
 *
 * v8 — history drawer + memory modal (matches the website's sidebar).
 *
 *   • User feedback: "This should be added in the AI same as the
 *     website so somebody could browse their all chat in their memory
 *     and they could import memory from other AI."
 *   • New header-left "menu" button opens a slide-in HistoryDrawer
 *     (mobile twin of the web's HistorySidebar). The drawer renders
 *     past chats grouped by Today / Yesterday / Last 7 / Earlier, a
 *     Memory shortcut card showing "N things the AI remembers", and
 *     plans — same layout the web ships.
 *   • Tapping a chat in the drawer fetches its full messages JSONB
 *     (via fetchSessionById) and rehydrates the in-memory `messages`
 *     state so the user picks up exactly where they left off. We
 *     also auto-switch the PersonaToggle: a Tony session loads with
 *     Tony selected, a Sherlock session flips to Sherlock.
 *   • Tapping "Teach your AI about you" on the memory card opens
 *     MemoryModal — list/add/import phases — wired to the same
 *     `student_memory` Supabase table the web reads from. Memory is
 *     shared across both personas, both web + mobile, one row each.
 *
 * v7.1 — prefill is now consumed on every focus, not just on mount.
 *
 *   • Bug: the user typed in AskTonyHomeHero on Home, tapped "Ask",
 *     was navigated to AI — but the composer was empty (or stuck on
 *     the OLD draft from a previous hand-off). Root cause: the AI
 *     tab is a bottom-tab screen that stays mounted across tab
 *     switches, so the old `useEffect(..., [])` only fired the very
 *     first time the user visited the tab. Every subsequent hand-off
 *     wrote to MAGIC_PREFILL_KEY in AsyncStorage with no consumer.
 *   • Fix: swapped the mount-only effect for `useFocusEffect`, which
 *     re-runs every time the tab gains focus. Now each Home → Ask
 *     trip lands on AI with the freshly-staged text already in the
 *     composer (and the AsyncStorage key cleared so the next visit
 *     starts clean).
 *
 * v7 — keyboard animation is now in lock-step with the OS.
 *
 *   • The `kbVisible` flip that swaps the composer's bottom padding
 *     between `tabBarHeight + sm` and `sm` used to happen on the next
 *     React commit — independent of the keyboard slide — so the
 *     composer "popped" while the keyboard was still mid-animation.
 *     We now call `LayoutAnimation.configureNext` inside the
 *     keyboard listener using the OS-reported `duration` and the
 *     `keyboard` easing curve, so the composer's padding transition
 *     runs on the EXACT same timing as the keyboard slide. Result:
 *     no visible jitter, the input glides up with the keyboard.
 *   • Android opts in via `UIManager.setLayoutAnimationEnabledExperimental`
 *     once at module load (no-op on iOS / new arch).
 *
 * v6 — Sherlock is a chat + streaming parser + keyboard layout fixes.
 *
 * v6 changes (latest user feedback, 5 screenshots of basudrus.com):
 *   • Sherlock is now a CHAT (not a static pane). Mirrors the web's
 *     /ai?p=noor view — same green check-in card, pink relationship
 *     card, suggestion chips, "Share what's on your mind…" composer,
 *     "Sherlock isn't a therapist. Crisis? …" disclaimer. The mode
 *     bar (Auto/Hints/Teach/Walkthrough) only shows for Tony.
 *   • Streaming parser fix: React Native's fetch doesn't always
 *     expose `res.body` as a stream. The old fallback dumped the raw
 *     SSE text into the bubble, so users saw literal
 *     `data: {"content":" plate right now? …"}` chunks. We now run an
 *     `extractSSEContent` helper on the text fallback that walks each
 *     `data: …` line, JSON-parses it, and concatenates the `.content`
 *     tokens — same shape as the streaming path.
 *   • Keyboard layout: removed `justifyContent: 'flex-end'` on the
 *     FlatList's empty state. With flex-end the empty state stuck to
 *     the bottom of the FlatList area; when the keyboard appeared the
 *     area shrank, the empty state overflowed, and only the top of it
 *     (the italic greeting) was visible — the cards and chips fell
 *     off-screen below the composer. Now the empty state sits from
 *     the top of the scroll area so cards stay visible as the area
 *     shrinks, and the user can scroll if needed.
 *   • Greeting fontSize 36→28 so it fits on a single line on smaller
 *     phones and doesn't dominate the empty state when the keyboard
 *     is up.
 *   • Composer placeholder is persona-aware
 *     ("Message Tony…" / "Share what's on your mind…").
 *
 * v5 (previous): PersonaToggle + EmptyState + tab-bar height
 *   composer padding. Most of that is preserved here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { authedFetch } from '@/lib/api';
import { MAGIC_PREFILL_KEY } from '@/components/MagicMomentCard';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useGameTracking } from '@/hooks/useGameTracking';
import { thump, tap, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { HistoryDrawer } from '@/components/HistoryDrawer';
import { MemoryModal } from '@/components/MemoryModal';
import { ChoiceCard } from '@/components/ChoiceCard';
import { fetchSessionById, type SessionListItem } from '@/hooks/useAIHistory';
import {
  appendChatMessages,
  startOrResumeChatSession,
  type ChatPersona,
} from '@/lib/chatSessionStore';
import {
  MAX_FREE_MESSAGES_PER_DAY,
  getTodayCount,
  incrementTodayCount,
  isOverFreeQuota,
} from '@/lib/aiQuota';
import { parseAssistantMessage } from '@/lib/parseChoices';

// Old-arch Android requires opting into LayoutAnimation. Harmless no-op
// elsewhere. We use LayoutAnimation in the keyboard listener so the
// composer's padding-bottom shrink/grow rides the same timing curve as
// the OS keyboard slide instead of snapping discretely.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Persona = 'tony' | 'sherlock';
type TutorMode = 'auto' | 'homework_help' | 'study_mode' | 'homework_helper';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
};

/**
 * Same purple as the website uses for Tony's accents (#5B4BF5). The
 * theme accent ({ dark: '#00d4ff', light: '#007aff' }) reads as the
 * Bas Udrus general brand colour but the website specifically uses
 * this violet for Tony's persona surfaces so the eye associates it
 * with "tutor mode". Keep it as a literal because it never changes
 * between light/dark.
 */
const TONY_PURPLE = '#5B4BF5';

/**
 * Quick actions — the three stacked rows that sit just above the
 * composer when no messages exist (mirrors ChatGPT mobile's
 * "Create an image / Write or edit / Look something up").
 *
 * They live OUTSIDE the FlatList so the keyboard doesn't push them
 * off-screen — they ride up with the composer instead. Disappear the
 * moment the user sends their first message.
 */
type QuickAction = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  // The literal prompt sent when tapped (gets typed into Tony/Sherlock
  // as if the user wrote it).
  prompt: string;
};

const TONY_QUICK: QuickAction[] = [
  { label: 'Help with homework',  icon: 'book-outline',     prompt: 'Help me with a homework problem — I\'ll paste it next.' },
  { label: 'Explain a concept',   icon: 'bulb-outline',     prompt: 'Explain a concept I\'m stuck on.' },
  { label: 'Quiz me',             icon: 'sparkles-outline', prompt: 'Quiz me on something I\'m studying.' },
];

const SHERLOCK_QUICK: QuickAction[] = [
  { label: 'Take a 2-min check-in',     icon: 'heart-outline',     prompt: 'Take a 2-min check-in with me (PHQ-9 or GAD-7).' },
  { label: 'Talk about a relationship', icon: 'people-outline',    prompt: 'I want to talk about something happening in a relationship — could be romantic, a friendship, or family.' },
  { label: 'Vent about today',          icon: 'chatbubbles-outline', prompt: 'I just need to vent about something annoying that happened today.' },
];

const TUTOR_MODES: { id: TutorMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'auto',             label: 'Auto',        icon: 'sparkles-outline' },
  { id: 'homework_help',    label: 'Hints',       icon: 'bulb-outline' },
  { id: 'study_mode',       label: 'Teach',       icon: 'book-outline' },
  { id: 'homework_helper',  label: 'Walkthrough', icon: 'footsteps-outline' },
];

/**
 * Walk an SSE blob and concatenate the `content` tokens.
 *
 * Used as a fallback when React Native's fetch doesn't expose
 * `res.body` as a stream (which is most of the time on iOS). Without
 * this the whole `data: {"content":"..."} \n data: {"content":"..."}`
 * payload was being dumped straight into the chat bubble — that's the
 * "raw data: JSON in the message" bug from the screenshot.
 *
 * Accepts the same chunk shapes the streaming path handles:
 *   • `{ content: "…" }` (basudrus.com/api/ai/tutor)
 *   • OpenAI-style `{ choices: [{ delta: { content: "…" }}] }`
 *   • `{ text: "…" }`
 * Falls through to the raw string if the payload isn't SSE at all
 * (e.g. plain text errors).
 */
function extractSSEContent(raw: string): string {
  if (!raw.includes('data:')) return raw;
  const parts: string[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') break;
      continue;
    }
    try {
      const j = JSON.parse(data);
      const tok =
        (typeof j.content === 'string' ? j.content : null) ??
        j.choices?.[0]?.delta?.content ??
        j.text ??
        '';
      if (tok) parts.push(tok);
    } catch {
      // Non-JSON data line (rare) — keep it so we don't lose content.
      parts.push(data);
    }
  }
  return parts.length > 0 ? parts.join('') : raw;
}

export default function AIScreen() {
  const { c, mode } = useTheme();
  const dark = mode === 'dark';
  const insets = useSafeAreaInsets();
  // The absolute-positioned tab bar steals the bottom slot. We need
  // its real pixel height (≈83pt iOS, ≈56pt+insets Android) to keep
  // the composer above it.
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { session } = useAuth();

  const [persona, setPersona] = useState<Persona>('tony');
  const [tutorMode, setTutorMode] = useState<TutorMode>('auto');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [isPro, setIsPro] = useState(false);
  // Persisted-session bookkeeping. The AI tab streams replies from the
  // server but, until now, never wrote rows to `tutor_sessions` /
  // `wellbeing_sessions`. The History drawer reads those tables, so
  // every visit looked empty — that's the user report
  // ("history isn't being saved, maybe after I sign in"). We now open
  // (or resume) a row on the FIRST user message of a chat and append
  // the (user, assistant) pair after each reply lands. We use a ref
  // rather than state because `send()` is an async closure — by the
  // time the assistant reply arrives, a state value captured at the
  // top of `send` is stale, but a ref always points at the current
  // session id even across rapid-fire turns. No render needs to react
  // to this value, so a ref is the lighter primitive.
  const currentSessionIdRef = useRef<string>('');
  // Bump this when a new session row is created (or resumed) so the
  // HistoryDrawer's useAIHistory hook re-runs its refresh — otherwise
  // the drawer wouldn't see the fresh chat until the user pulled to
  // refresh. Passed as a prop the drawer can effect-on.
  const [historyTick, setHistoryTick] = useState(0);
  // Free-tier daily quota. Non-Pro users get MAX_FREE_MESSAGES_PER_DAY
  // sends before they're prompted to upgrade. Stored per-user-per-day
  // in AsyncStorage (rolls over at local midnight). Pro users see no
  // counter and aren't gated.
  const [freeCountToday, setFreeCountToday] = useState(0);
  const overQuota = isOverFreeQuota(freeCountToday, isPro);
  // History drawer (chats + memory shortcut) — opened from the new
  // header-left menu button. Mirrors the web's HistorySidebar.
  // memoryOpen is lifted to this level so the MemoryModal can render
  // as a sibling of the drawer (avoids nested-Modal quirks on Android).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  // Track keyboard visibility so the composer can collapse its
  // bottom padding when the keyboard is up. The composer normally
  // reserves `tabBarHeight + sm` at the bottom so it clears the
  // floating tab bar — but when the keyboard appears, the tab bar
  // is hidden behind the keyboard and that reserved space turns
  // into a huge gap between the composer and the keyboard top.
  // Collapsing to `sm` keeps the input glued to the keyboard.
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    // iOS gets the `Will` events (sync with the slide-in animation);
    // Android only fires `Did`, so we listen to both.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    // Hand the keyboard's own duration + easing to LayoutAnimation so
    // the composer's padding transition runs on the exact same curve.
    // Without this, kbVisible flipped on the next frame and the
    // composer "popped" while the keyboard slid — visible jitter.
    // iOS exposes both fields on the event; Android usually fires
    // after the animation, but configureNext still smooths the
    // resulting layout pass so it never looks abrupt.
    const onChange = (next: boolean) => (e: KeyboardEvent) => {
      LayoutAnimation.configureNext({
        duration: e?.duration || 250,
        update: { type: 'keyboard' },
      });
      setKbVisible(next);
    };
    const show = Keyboard.addListener(showEvt, onChange(true));
    const hide = Keyboard.addListener(hideEvt, onChange(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // The `/api/ai/tutor` edge function REQUIRES `userId` and reads
  // uni/major/year/studentName to personalise Tony's tone. Loaded
  // once on mount; without it the tab feels "broken".
  const [tutorCtx, setTutorCtx] = useState<{
    uni: string;
    major: string;
    year: string;
    studentName: string;
  }>({ uni: '', major: '', year: '', studentName: '' });

  const listRef = useRef<FlatList>(null);
  const { awardXP } = useGameTracking();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = session?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from('profiles')
        .select('pro, uni, major, year, name')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? null) as
        | { pro?: boolean; uni?: string | null; major?: string | null; year?: string | null; name?: string | null }
        | null;
      setIsPro(row?.pro === true);
      setTutorCtx({
        uni: row?.uni ?? '',
        major: row?.major ?? '',
        year: row?.year ?? '',
        studentName: row?.name ?? '',
      });
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Hydrate today's free-tier message count from AsyncStorage so the
  // counter UI ("8 of 10 free messages used today") is accurate the
  // instant the user lands on the tab. We don't gate UI on this resolving
  // because the gate inside `send()` re-reads the latest count anyway —
  // this is purely for the chip displayed above the composer.
  // Re-runs when the user signs in/out so a fresh sign-in pulls THEIR
  // quota (not the previous user's), and a sign-out resets to 0.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = session?.user?.id;
      if (!uid) {
        if (!cancelled) setFreeCountToday(0);
        return;
      }
      const n = await getTodayCount(uid);
      if (!cancelled) setFreeCountToday(n);
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Pick up a prefill that the Home screen (AskTonyHomeHero or
  // MagicMomentCard) staged for us. Reading + clearing in the same
  // tick prevents the prompt from re-injecting after the first send.
  // Tony only — Sherlock doesn't participate in the magic-moment flow.
  //
  // CRITICAL: this MUST run on every focus, not just on mount. The AI
  // tab is part of the tab navigator and stays mounted across tab
  // switches — so a mount-only effect would catch the very first
  // hand-off and silently ignore every subsequent one (user types in
  // Home → taps Ask → lands on AI with the OLD draft still in the
  // composer). useFocusEffect re-runs every time the screen comes
  // back to the foreground, which is exactly when a freshly-staged
  // prefill needs to be consumed. That was the user's reported bug:
  // "if I write a message on AI in the homepage … and then I click
  // like ask it does not copy the same message that goes to the AI
  // page". Same fix the web's /ai page would need if it were tabbed.
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(MAGIC_PREFILL_KEY)
        .then(v => {
          if (!v) return;
          setPersona('tony');
          setInput(v);
          AsyncStorage.removeItem(MAGIC_PREFILL_KEY).catch(() => {});
        })
        .catch(() => {});
    }, []),
  );

  const requirePro = useCallback((featureName: string) => {
    tap();
    if (isPro) {
      hError();
      // eslint-disable-next-line no-console
      console.log('[ai] Pro feature tapped:', featureName);
      return;
    }
    router.push('/upgrade');
  }, [isPro, router]);

  // Resume a chat the user tapped in the HistoryDrawer.
  // Pulls the full messages JSONB from Supabase (tutor_sessions or
  // wellbeing_sessions depending on persona), maps server roles into
  // our local Msg shape, and rehydrates state. Also auto-flips the
  // PersonaToggle so a Sherlock session loads with Sherlock selected
  // and Tony's mode bar disappears — same UX as the web.
  //
  // Crucially: we set `currentSessionIdRef` to the resumed row's id so
  // the next user message APPENDS to that row instead of opening a
  // brand-new one. Without this, "open a chat from history → type
  // something" would have silently spawned a separate empty session
  // and the drawer would show two rows where the user expected one.
  const resumeSession = useCallback(async (item: SessionListItem) => {
    const full = await fetchSessionById(item.id, item.persona);
    if (!full) {
      hError();
      return;
    }
    const restored: Msg[] = full.messages.map((m, i) => ({
      id: `${full.id}-${i}`,
      role: m.role,
      text: m.content,
    }));
    setMessages(restored);
    setPersona(item.persona === 'noor' ? 'sherlock' : 'tony');
    setInput('');
    currentSessionIdRef.current = full.id;
    scrollToEnd(false);
  }, []);

  const scrollToEnd = (animated = true) =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated }), 60);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;

    // ── Free-tier daily cap ──
    // Non-Pro users get MAX_FREE_MESSAGES_PER_DAY sends per local day.
    // We re-read the storage value (rather than trusting the in-memory
    // `freeCountToday`) because (a) the user could send from two devices
    // and (b) the date may have rolled over since mount — `getTodayCount`
    // keys on today's YYYY-MM-DD so a midnight crossing auto-resets.
    // Pro users skip the gate entirely.
    if (!isPro && session?.user?.id) {
      const latest = await getTodayCount(session.user.id);
      if (latest !== freeCountToday) setFreeCountToday(latest);
      if (isOverFreeQuota(latest, false)) {
        hError();
        router.push('/upgrade');
        return;
      }
    }

    const uid = Date.now().toString();
    const userMsg: Msg = { id: uid, role: 'user', text };
    const allMsgs = [...messages, userMsg];
    // Snapshot of the user's message in the storage shape — captured
    // here so we can persist it later regardless of how the assistant
    // reply lands (success, error, or mid-stream abort).
    const userTs = new Date().toISOString();
    const personaForPersistence: ChatPersona = persona;
    const userIdForPersistence = session?.user?.id ?? '';

    setInput('');
    setSending(true);
    // Drop the keyboard the moment they tap send — matches Claude /
    // ChatGPT mobile. The streaming response is what they want to
    // watch next, not the input they just emptied, and the
    // composer's padding shrink/grow is already on the OS keyboard
    // curve so the dismiss looks smooth instead of snappy.
    Keyboard.dismiss();
    thump();

    const streamId = uid + '_stream';
    setMessages([...allMsgs, { id: streamId, role: 'assistant', text: '', streaming: true }]);
    scrollToEnd(false);

    // ── Persistence: ensure a session row exists BEFORE the reply ──
    //
    // We open (or resume) the row right after the user message hits
    // local state. Two reasons for doing it here vs. after the reply:
    //   1. The History drawer can show the chat the instant the user
    //      taps Send, even if the network is slow — they tap menu,
    //      they see "Today" with their chat title.
    //   2. If the reply errors out mid-stream, the user's message is
    //      still safely persisted; without an early open we'd lose
    //      it entirely on failure.
    // Best-effort: a missing userId (signed out) just yields '', and
    // appendChatMessages no-ops on empty id below. The chat keeps
    // working; only persistence is off.
    if (userIdForPersistence && !currentSessionIdRef.current) {
      const newId = await startOrResumeChatSession(
        userIdForPersistence,
        personaForPersistence,
      );
      if (newId) {
        currentSessionIdRef.current = newId;
        // Kick the drawer so the fresh row appears under "Today" the
        // next time the user opens it (or if it's already open).
        setHistoryTick(t => t + 1);
      }
    }

    try {
      // Full payload mirroring web's useStreamingAI shape.
      const res = await authedFetch('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({
          messages: allMsgs.map(m => ({ role: m.role, content: m.text })),
          subject: '',
          major: tutorCtx.major,
          year: tutorCtx.year,
          uni: tutorCtx.uni,
          studentName: tutorCtx.studentName,
          userId: session?.user?.id ?? '',
          // Tony only — Sherlock ignores `mode`.
          // `auto` is also ignored by the API (it just means "let server
          // pick"), so we send undefined to mirror web behaviour.
          mode: persona === 'tony' && tutorMode !== 'auto' ? tutorMode : undefined,
          persona: persona === 'tony' ? 'omar' : 'noor',
        }),
      });

      if (!res.ok) {
        let serverMessage: string | null = null;
        try {
          const j = await res.clone().json();
          serverMessage = typeof j?.error === 'string' ? j.error : null;
        } catch { /* not JSON */ }
        throw new Error(serverMessage ?? `HTTP ${res.status}`);
      }

      let fullText = '';

      if (res.body && typeof (res.body as ReadableStream).getReader === 'function') {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = '';

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const t = line.trim();
            if (!t || t === ':') continue;

            if (t.startsWith('data: ')) {
              const data = t.slice(6).trim();
              if (data === '[DONE]') break outer;

              let token = '';
              try {
                const parsed = JSON.parse(data);
                // basudrus.com/api/ai/tutor returns `{ content: "..." }`
                // per chunk; OpenAI-style is a fallback for forward-compat.
                token =
                  (typeof parsed.content === 'string' ? parsed.content : null) ??
                  parsed.choices?.[0]?.delta?.content ??
                  parsed.text ??
                  '';
              } catch {
                token = data;
              }

              if (token) {
                fullText += token;
                const snap = fullText;
                setMessages(prev =>
                  prev.map(m =>
                    m.id === streamId ? { ...m, text: snap, streaming: true } : m
                  )
                );
                scrollToEnd(false);
              }
            }
          }
        }
      } else {
        // RN fetch usually doesn't expose `res.body` as a stream, so
        // we land here. The payload could be plain JSON, raw SSE
        // ("data: {…}\n…"), or plain text — extractSSEContent handles
        // the SSE case so we don't dump raw `data:` lines into the
        // bubble.
        const raw = await res.text();
        try {
          const parsed = JSON.parse(raw);
          fullText = parsed.text ?? parsed.reply ?? parsed.content ?? raw;
        } catch {
          fullText = extractSSEContent(raw);
        }
        setMessages(prev =>
          prev.map(m => (m.id === streamId ? { ...m, text: fullText, streaming: true } : m))
        );
      }

      const finalText =
        fullText || "I'm here — try rephrasing your question.";
      setMessages(prev =>
        prev.map(m =>
          m.id === streamId
            ? { ...m, text: finalText, streaming: false }
            : m
        )
      );

      // ── Persistence: append the (user, assistant) pair ──
      // Fire-and-forget — already best-effort inside the helper. We
      // pass the explicit (persona, userId) captured at send-time
      // rather than reading state here so a mid-flight persona switch
      // can't write the turn to the wrong table. If the open above
      // produced no session id (signed out, or DB blip), the helper
      // no-ops on empty id and the chat keeps working without history.
      const sid = currentSessionIdRef.current;
      if (sid) {
        const replyTs = new Date().toISOString();
        void appendChatMessages(sid, personaForPersistence, [
          { role: 'user', content: text, ts: userTs },
          { role: 'assistant', content: finalText, ts: replyTs },
        ]).then(ok => {
          // Only ping the drawer when the write actually landed so we
          // don't churn it on every failed turn. The drawer subscribes
          // to historyTick and re-runs useAIHistory.refresh() on bump.
          if (ok) setHistoryTick(t => t + 1);
        });
      }

      void awardXP(5);

      // Bump the per-day free-tier counter after a successful reply.
      // Counting on success (not on send-attempt) means a network blip
      // doesn't cost the user a slot from their daily 10. Pro users
      // skip — they have no cap so the storage write would be wasted.
      if (!isPro && session?.user?.id) {
        const next = await incrementTodayCount(session.user.id);
        setFreeCountToday(next);
      }
    } catch (e) {
      hError();
      const msg = e instanceof Error ? e.message : 'please try again';
      const who = persona === 'tony' ? 'Tony' : 'Sherlock';
      const errText = `Couldn't reach ${who} right now — ${msg}`;
      setMessages(prev =>
        prev.map(m =>
          m.id === streamId
            ? { ...m, text: errText, streaming: false }
            : m
        )
      );
      // Still persist the user's message so they can resume the chat
      // and try again from the drawer. We skip the assistant placeholder
      // because the error text is local UI scaffolding, not a real
      // model reply we want stored alongside future turns.
      const sid = currentSessionIdRef.current;
      if (sid) {
        void appendChatMessages(sid, personaForPersistence, [
          { role: 'user', content: text, ts: userTs },
        ]);
      }
    } finally {
      setSending(false);
      scrollToEnd();
    }
  };

  // ──────────────────────── render ────────────────────────

  // Single chat body used by BOTH personas. Sherlock no longer renders
  // a separate static pane — instead it gets a chat with a different
  // empty state (mental-health entry cards + suggestion chips), no
  // tutor mode bar, a "Share what's on your mind…" placeholder and a
  // tappable crisis hint. Matches basudrus.com/ai?p=noor.
  const renderBody = () => (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      // Both platforms now use `padding`. On Expo SDK 54 (RN 0.81 +
      // newArchEnabled) Android renders edge-to-edge by default, so
      // the OS no longer resizes the window when the keyboard opens
      // — `behavior={undefined}` on Android meant the KAV did
      // NOTHING, and the soft keyboard slid up OVER the composer.
      // That's the "the box where you type isn't appearing when
      // the keyboard is up" bug the user reported. `padding`
      // works on both surfaces: when the keyboard opens, the KAV
      // adds bottom padding equal to the keyboard height so the
      // composer (at the column's tail) glides up just above the
      // keyboard top.
      behavior="padding"
      // Offset = 0. The KAV's bottom edge is already at the screen
      // bottom (the tab bar floats *over* the KAV with
      // position:absolute), so we want the KAV to push content up by
      // the full keyboard height. Using a non-zero offset like
      // `tabBarHeight` here was leaving a tabBarHeight-sized gap
      // between the composer and the keyboard top — that's the
      // "huge empty space between keyboard and screen" bug.
      keyboardVerticalOffset={0}
    >
      <FlatList
        ref={listRef}
        // flex:1 here is critical. Without it, the FlatList only takes
        // as much height as its content (0 when empty), and the
        // composer floats to the middle of the KAV instead of sitting
        // pinned to the bottom.
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          paddingBottom: space.md,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        renderItem={({ item }) => (
          <Bubble msg={item} onPick={label => send(label)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        onContentSizeChange={() => {
          if (messages.length > 0) listRef.current?.scrollToEnd({ animated: false });
        }}
      />

      {/* Quick actions — only when the chat is empty. They live OUT of
          the FlatList so the keyboard pushes them up with the composer
          instead of clipping them. Vanish after the first message. */}
      {messages.length === 0 ? (
        <QuickActions persona={persona} onPick={q => send(q)} />
      ) : null}

      {/* MODE bar — Tony only. Sherlock doesn't have tutor modes.
          Currently HIDDEN from the UI per product feedback ("keep auto
          on, don't show the chips"). The `tutorMode` state still
          defaults to 'auto' and the server still receives that mode
          on every request — we're just not exposing Hints / Teach /
          Walkthrough as a chip row anymore. The render block, the
          TUTOR_MODES constant, and the setTutorMode setter are all
          kept in place so a future "advanced settings" surface can
          flip this back on without re-implementing the picker.
          Set SHOW_MODE_BAR to true to re-enable. */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      {false && persona === 'tony' ? (
        <View style={[styles.modeBar, { backgroundColor: c.bgElevated, borderTopColor: c.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modeBarInner}
          >
            {TUTOR_MODES.map(m => {
              const active = m.id === tutorMode;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => { tap(); setTutorMode(m.id); }}
                  style={({ pressed }) => [
                    styles.modeChip,
                    {
                      backgroundColor: active
                        ? (dark ? '#2a2a2c' : '#ffffff')
                        : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
                      borderColor: active
                        ? (dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)')
                        : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={m.icon}
                    size={12}
                    color={active ? c.text : c.textMuted}
                  />
                  <Text
                    style={[
                      styles.modeChipText,
                      { color: active ? c.text : c.textMuted, fontWeight: active ? '700' : '500' },
                    ]}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Free-tier daily counter — only visible to non-Pro users. Shows
          "X of 10 free messages used today" with a tap-to-upgrade link.
          When the cap is hit, the messaging flips to a hard upgrade
          prompt and the composer below it disables itself. We render
          this above the composer (and above the mode bar would be too
          high — users associate it with sending). */}
      {!isPro ? (
        <Pressable
          onPress={() => { tap(); router.push('/upgrade'); }}
          style={({ pressed }) => [
            styles.quotaBanner,
            {
              backgroundColor: overQuota
                ? (dark ? 'rgba(194,63,108,0.16)' : 'rgba(194,63,108,0.08)')
                : c.bgElevated,
              borderTopColor: c.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            overQuota
              ? 'Daily free messages used up. Tap to upgrade.'
              : `${Math.min(freeCountToday, MAX_FREE_MESSAGES_PER_DAY)} of ${MAX_FREE_MESSAGES_PER_DAY} free messages used today. Tap to upgrade.`
          }
        >
          <Ionicons
            name={overQuota ? 'lock-closed' : 'flash-outline'}
            size={12}
            color={overQuota ? '#C23F6C' : c.textMuted}
          />
          <Text
            style={[
              styles.quotaText,
              { color: overQuota ? '#C23F6C' : c.textMuted },
            ]}
            numberOfLines={1}
          >
            {overQuota
              ? `Daily limit reached (${MAX_FREE_MESSAGES_PER_DAY}/${MAX_FREE_MESSAGES_PER_DAY}). `
              : `${Math.min(freeCountToday, MAX_FREE_MESSAGES_PER_DAY)} of ${MAX_FREE_MESSAGES_PER_DAY} free today · `}
            <Text style={{ color: TONY_PURPLE, fontWeight: '700' }}>
              {overQuota ? 'Upgrade for unlimited' : 'Upgrade'}
            </Text>
          </Text>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: c.bgElevated,
            borderTopColor: c.border,
            // Composer's bottom padding adapts to the keyboard:
            //   • Keyboard down → reserve tabBarHeight + sm so the
            //     input sits above the floating tab bar.
            //   • Keyboard up   → tab bar is hidden under keyboard,
            //     so we only need a thin gap (sm) above the keyboard
            //     top. Otherwise we'd leave a tabBarHeight-sized
            //     empty band between the composer and the keyboard.
            paddingBottom: kbVisible ? space.sm : tabBarHeight + space.sm,
          },
        ]}
      >
        <View style={styles.composerRow}>
          <Pressable
            onPress={() => requirePro('attach')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.attachBtn,
              {
                backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="add" size={22} color={c.textMuted} />
          </Pressable>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={persona === 'tony' ? 'Message Tony…' : "Share what's on your mind…"}
            placeholderTextColor={c.textFaint}
            multiline
            blurOnSubmit={false}
            style={[
              styles.composerInput,
              { color: c.text, backgroundColor: c.bg, borderColor: c.border },
            ]}
          />

          <Pressable
            onPress={() => send()}
            disabled={!input.trim() || sending || overQuota}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                // overQuota visually flips the button to a "locked"
                // state so the user understands why it won't fire — the
                // quota banner above already tells them what to do.
                backgroundColor:
                  overQuota
                    ? c.bgCard
                    : input.trim() && !sending
                    ? TONY_PURPLE
                    : c.bgCard,
                opacity: pressed
                  ? 0.75
                  : input.trim() && !sending && !overQuota
                  ? 1
                  : 0.45,
              },
            ]}
          >
            <Ionicons
              name={overQuota ? 'lock-closed' : 'arrow-up'}
              size={20}
              color={input.trim() && !sending && !overQuota ? '#fff' : c.textMuted}
            />
          </Pressable>
        </View>

        {persona === 'tony' ? (
          <Text style={[styles.composerHint, { color: c.textFaint }]}>
            Tony can be wrong — check important answers.
          </Text>
        ) : (
          // Sherlock disclaimer doubles as a crisis-line tap target so
          // the 911 hotline (which used to live in MentalHealthPane)
          // is still one tap away.
          <Pressable
            onPress={() => {
              tap();
              Linking.openURL('tel:911').catch(() => { /* no dialer */ });
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            accessibilityRole="button"
            accessibilityLabel="Call emergency services"
          >
            <Text style={[styles.composerHint, { color: c.textFaint }]}>
              Sherlock isn&apos;t a therapist.{' '}
              <Text style={{ color: '#C23F6C', fontWeight: '600' }}>
                Crisis? Tap to call 911.
              </Text>
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );

  const newChat = useCallback(() => {
    tap();
    setMessages([]);
    setInput('');
    // Clear the session pointer so the NEXT message opens a fresh row
    // instead of appending to the previous chat the user just walked
    // away from. Without this, "tap + (new chat) → send" would silently
    // continue the prior session and the drawer would show only one
    // row that grew indefinitely.
    currentSessionIdRef.current = '';
  }, []);

  // Persona swap should isolate sessions per persona — a Tony chat in
  // progress shouldn't pollute the next Sherlock chat (different table,
  // different shape, different drawer badge). We treat a switch as
  // "start a fresh chat in the other persona": clear the visible
  // messages and drop the session pointer so the next message opens
  // (or resumes) on the correct side.
  //
  // We DO leave the persona-switch UX side-effects (haptics, animation)
  // to PersonaToggle — this wrapper only handles the data hygiene.
  const handlePersonaChange = useCallback((next: Persona) => {
    if (next === persona) return;
    setPersona(next);
    setMessages([]);
    setInput('');
    currentSessionIdRef.current = '';
  }, [persona]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      {/* Compact header — centered PersonaToggle, history menu on the
          left (chats + memory shortcut), optional Pro pill or new-chat
          icon on the right. Mirrors ChatGPT mobile's top bar but the
          left "menu" is the website's HistorySidebar. */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={() => {
              tap();
              setHistoryOpen(true);
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerIconBtn,
              {
                borderColor: c.border,
                backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Chats and memory"
          >
            <Ionicons name="menu" size={18} color={c.text} />
          </Pressable>
        </View>
        <PersonaToggle value={persona} onChange={handlePersonaChange} />
        <View style={{ flex: 1, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
          {messages.length > 0 ? (
            <Pressable
              onPress={newChat}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  borderColor: c.border,
                  backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="New chat"
            >
              <Ionicons name="create-outline" size={16} color={c.text} />
            </Pressable>
          ) : null}
          {isPro ? (
            <View style={[styles.proPill, { borderColor: c.borderStrong }]}>
              <Ionicons name="infinite" size={11} color={c.text} />
              <Text style={[styles.proPillText, { color: c.text }]}>Pro</Text>
            </View>
          ) : null}
        </View>
      </View>

      {renderBody()}

      {/* History drawer — slide-in left panel with past chats and the
          Memory shortcut card. Mounted at the screen root so its
          backdrop + slide animation overlay everything (composer,
          keyboard) instead of being clipped by the chat container.
          Profile is pulled from the same tutorCtx we load on mount so
          the header avatar + uni·major·year line are populated.  */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={resumeSession}
        onOpenMemory={() => setMemoryOpen(true)}
        profile={{
          name: tutorCtx.studentName || null,
          uni: tutorCtx.uni || null,
          major: tutorCtx.major || null,
          year: tutorCtx.year || null,
        }}
        // Bumped after each successful persist so the drawer reloads
        // its chat list — "Today" then shows the chat the user is
        // having right now without needing pull-to-refresh.
        refreshSignal={historyTick}
      />

      {/* Memory modal — sibling of HistoryDrawer rather than nested
          inside it so opening it doesn't fight Android's modal stack.
          The drawer closes itself before asking us to open this. */}
      <MemoryModal
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        studentName={tutorCtx.studentName || null}
      />
    </View>
  );
}

// ──────────────────────── PersonaToggle ────────────────────────

function PersonaToggle({
  value,
  onChange,
}: {
  value: Persona;
  onChange: (next: Persona) => void;
}) {
  const { c, mode } = useTheme();
  const dark = mode === 'dark';
  const [trackWidth, setTrackWidth] = useState(0);
  const half = trackWidth / 2;
  const slideX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideX, {
      toValue: value === 'tony' ? 0 : half,
      useNativeDriver: true,
      tension: 220,
      friction: 22,
    }).start();
  }, [value, half, slideX]);

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View
        style={[
          styles.toggleTrack,
          {
            backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
            borderColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
          },
        ]}
        onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {half > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.togglePill,
              {
                width: half - 4,
                backgroundColor: dark ? '#2a2a2c' : '#ffffff',
                shadowColor: '#000',
                shadowOpacity: dark ? 0.4 : 0.12,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 2,
                transform: [{ translateX: slideX }],
              },
            ]}
          />
        ) : null}

        <Pressable
          onPress={() => { if (value !== 'tony') { tap(); onChange('tony'); } }}
          style={styles.toggleSeg}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === 'tony' }}
        >
          <MaterialCommunityIcons
            name="brain"
            size={14}
            color={value === 'tony' ? c.text : c.textMuted}
          />
          <Text
            style={[
              styles.toggleLabel,
              { color: value === 'tony' ? c.text : c.textMuted, fontWeight: value === 'tony' ? '700' : '500' },
            ]}
          >
            Tony Starrk
          </Text>
        </Pressable>

        <Pressable
          onPress={() => { if (value !== 'sherlock') { tap(); onChange('sherlock'); } }}
          style={styles.toggleSeg}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === 'sherlock' }}
        >
          <Ionicons
            name="heart"
            size={13}
            color={value === 'sherlock' ? c.text : c.textMuted}
          />
          <Text
            style={[
              styles.toggleLabel,
              { color: value === 'sherlock' ? c.text : c.textMuted, fontWeight: value === 'sherlock' ? '700' : '500' },
            ]}
          >
            Sherlock
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.toggleHint, { color: c.textFaint }]}>
        {value === 'tony' ? 'tutor & study plans' : 'wellbeing & relationships'}
      </Text>
    </View>
  );
}

// ──────────────────────── QuickActions ────────────────────────

/**
 * Three stacked action rows that sit JUST ABOVE the composer when the
 * chat is empty. Mirrors ChatGPT mobile's "Create an image / Write or
 * edit / Look something up" pattern from the user's screenshot.
 *
 * Lives OUTSIDE the FlatList so the keyboard pushes it up with the
 * composer instead of clipping it inside a shrinking scroll area —
 * that was the bug behind the empty-state screenshot where the
 * greeting was cropped and the cards fell off-screen.
 *
 * Hides once the user has sent at least one message
 * (`messages.length > 0`).
 */
function QuickActions({
  persona,
  onPick,
}: {
  persona: Persona;
  onPick: (prompt: string) => void;
}) {
  const { c, mode } = useTheme();
  const dark = mode === 'dark';
  const actions = persona === 'tony' ? TONY_QUICK : SHERLOCK_QUICK;

  return (
    <View style={styles.quickWrap}>
      {actions.map(a => (
        <Pressable
          key={a.label}
          onPress={() => { tap(); onPick(a.prompt); }}
          style={({ pressed }) => [
            styles.quickRow,
            { opacity: pressed ? 0.55 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={a.label}
        >
          <View
            style={[
              styles.quickIconWrap,
              {
                backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              },
            ]}
          >
            <Ionicons name={a.icon} size={18} color={c.text} />
          </View>
          <Text style={[styles.quickLabel, { color: c.text }]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ──────────────────────── chat bubbles ────────────────────────

/**
 * One chat row. For user turns it's just the purple bubble on the right.
 * For assistant turns we additionally look for a Claude-style choices
 * block in the text (see parseChoices.ts) — if the model emitted an
 * `<<option>>…<<end option>>` block, the prose lands in the bubble and
 * a tappable ChoiceCard renders just below it. Tapping a choice sends
 * that label as if the user typed it, via the `onPick` prop drilled
 * down from AIScreen.send.
 *
 * We deliberately hide the card while the message is still streaming —
 * the block may be partial mid-stream, and a card that fills in options
 * one-by-one would feel jittery. Once `streaming` flips off, the card
 * pops in with the full set.
 */
function Bubble({
  msg,
  onPick,
}: {
  msg: Msg;
  /** Tapping a choice card sends the option label as the next message. */
  onPick?: (label: string) => void;
}) {
  const { c } = useTheme();
  const mine = msg.role === 'user';

  // Parse assistant replies for the `<<option>>…<<end option>>` block.
  // User messages skip parsing — they never contain choice cards.
  // Returning `{ prose: text, choices: null }` for non-matching text
  // keeps the bubble visually identical to its pre-choices behaviour.
  const parsed = !mine ? parseAssistantMessage(msg.text) : null;
  const bodyText = parsed ? parsed.prose : msg.text;
  const choices = parsed?.choices ?? null;
  // Show the card only once the stream is complete and the parser found
  // a valid list of options. Without an onPick we'd be rendering dead
  // buttons, so skip in that case too.
  const showChoices = !mine && !msg.streaming && !!onPick && !!choices && choices.length > 0;

  return (
    // Column wrapper so the choice card stacks BELOW the bubble row.
    // Matched the bubble row's side-alignment (left for assistant) so
    // the card aligns with the bubble rather than centering oddly.
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
      <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
        {!mine ? (
          <View style={[styles.tonyAvatarWrap, { backgroundColor: TONY_PURPLE + '22' }]}>
            <MaterialCommunityIcons name="brain" size={14} color={TONY_PURPLE} />
          </View>
        ) : null}
        <View
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: TONY_PURPLE, maxWidth: '78%' }
              : { backgroundColor: c.bgCard, borderWidth: 1, borderColor: c.border, maxWidth: '86%' },
          ]}
        >
          {msg.streaming && bodyText === '' ? (
            <TypingDots />
          ) : (
            <Text style={{ color: mine ? '#fff' : c.text, fontSize: font.sizes.md, lineHeight: 22 }}>
              {bodyText}
              {msg.streaming ? <BlinkCursor color={c.accent} /> : null}
            </Text>
          )}
        </View>
      </View>

      {/* Choice cards — Claude AskUserQuestion-style numbered options.
          One tap on a card sends that label as the next user message,
          so the conversation history reads identically to the user
          having typed it themselves. */}
      {showChoices ? (
        <View style={{ paddingLeft: 26 + space.sm /* clear the avatar gutter */ }}>
          <ChoiceCard choices={choices!} onPick={onPick!} accent={TONY_PURPLE} />
        </View>
      ) : null}
    </View>
  );
}

function BlinkCursor({ color }: { color: string }) {
  const [vis, setVis] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVis(v => !v), 520);
    return () => clearInterval(id);
  }, []);
  return <Text style={{ color, opacity: vis ? 1 : 0 }}>▋</Text>;
}

function TypingDots() {
  return (
    <View style={styles.typingRow}>
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const { c } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.delay(Math.max(0, 480 - delay)),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={[
        styles.typingDot,
        {
          backgroundColor: c.textMuted,
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
  },
  proPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  proPillText: { fontSize: font.sizes.xs, fontWeight: '700', letterSpacing: 0.2 },
  headerIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },

  // persona toggle
  toggleTrack: {
    flexDirection: 'row',
    height: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
    position: 'relative',
  },
  togglePill: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    borderRadius: radius.pill,
  },
  toggleSeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    height: 30,
    justifyContent: 'center',
    zIndex: 1,
  },
  toggleLabel: {
    fontSize: font.sizes.sm,
    letterSpacing: 0.1,
  },
  toggleHint: {
    fontSize: 10.5,
    letterSpacing: 0.1,
  },

  // quick actions — three left-aligned rows that sit just above the
  // composer, mirroring ChatGPT mobile's empty-state pattern.
  quickWrap: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: 2,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  quickIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: font.sizes.md,
    fontWeight: '500',
    letterSpacing: -0.1,
  },

  // bubbles
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  bubbleLeft: { alignSelf: 'flex-start' },
  bubbleRight: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubble: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg },
  tonyAvatarWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },

  typingRow: { flexDirection: 'row', gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5 },

  // mode bar
  modeBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modeBarInner: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 6,
    alignItems: 'center',
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modeChipText: { fontSize: 12, letterSpacing: 0.1 },

  // free-tier daily counter — sits just above the composer
  // (and above the Tony mode bar if it's shown). Tap = navigate to
  // /upgrade. We keep the surface thin (one line, 10pt text) so it
  // doesn't compete with the composer for attention until the cap is
  // hit, when the colour goes warning-pink and the row sticks out.
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quotaText: {
    fontSize: 11,
    letterSpacing: 0.1,
  },

  // composer
  composer: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: font.sizes.md,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  composerHint: {
    marginTop: 6,
    fontSize: 10.5,
    textAlign: 'center',
    lineHeight: 14,
  },
});
