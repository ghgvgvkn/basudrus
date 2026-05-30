/**
 * Study Match — mobile port of `src/features/match/StudyMatchScreen.tsx`.
 *
 * Pushed via `router.push('/study-match')` from the home Study partner
 * card. Not a tab — the feature is focused (pick → match → verdict)
 * and the tab bar would just invite people to bail mid-flow.
 *
 * Four-phase state machine (mirrors the web):
 *   1. browsing  — header + tabs + candidate lists visible
 *   2. matching  — "Run AI match" pressed, POST in flight
 *   3. theater   — verdict came back; dialogue messages animate in
 *                  one at a time with typing-dot pauses (the YC demo
 *                  moment — "two AIs talking about you")
 *   4. verdict   — full verdict card with score / strengths / concerns
 *                  / suggested plan / "Send a study request" CTA
 *
 * Three entry points to pick a candidate:
 *   • Suggested — same uni, year ±3, ranked by shared subjects → major
 *                 match → year proximity → name
 *   • By email  — type their account email; server resolves via Admin
 *                 API, rate-limited to 10/hr to deter enumeration
 *   • From chats — people in your `connections` table (also eligible)
 *
 * The chat-theater is presentation — the actual server call is a
 * single LLM round-trip that returns the FULL dialogue + verdict at
 * once. The TYPING_MS / POST_DIALOGUE_MS pauses make it FEEL real-time.
 *
 * "Send a study request" reuses Discover's `connections` upsert
 * pattern → router.push(`/chat/:partnerId`), so once Tonys agree the
 * user lands in the messaging thread already.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  Heart,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Sparkles,
  UserPlus,
  Users2,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
  useStudyMatch,
  checkStudyMatchEligibility,
  type CandidateRow,
  type StudyMatchDialogueMessage,
  type StudyMatchVerdict,
} from '@/hooks/useStudyMatch';
import { Avatar } from '@/components/Avatar';
import { tap, thump, success as hSuccess, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';

// Tony's accent purple — kept literal (instead of pulled from the
// theme) so the Sparkles glyph reads the same purple in light + dark
// mode the way it does on the web.
const TONY_PURPLE = '#5B4BF5';

type Tab = 'suggested' | 'search' | 'chats';
type Phase = 'browsing' | 'matching' | 'theater' | 'verdict';

export default function StudyMatchScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const sm = useStudyMatch();
  const eligibility = checkStudyMatchEligibility(sm.viewerProfile);

  const [tab, setTab] = useState<Tab>('suggested');
  const [phase, setPhase] = useState<Phase>('browsing');
  const [activeCandidate, setActiveCandidate] = useState<CandidateRow | null>(null);

  const onRunMatch = async (candidate: CandidateRow) => {
    thump();
    setActiveCandidate(candidate);
    setPhase('matching');
    const verdict = await sm.runMatch(candidate.id);
    if (!verdict) {
      // sm.error is set already; back to browsing so the error banner
      // shows up above the tabs.
      setPhase('browsing');
      setActiveCandidate(null);
      hError();
      return;
    }
    setPhase(verdict.dialogue.length > 0 ? 'theater' : 'verdict');
  };

  const backToBrowsing = () => {
    tap();
    sm.clearVerdict();
    setActiveCandidate(null);
    setPhase('browsing');
  };

  // "Send a study request" → identical to Discover's Say-Hi flow:
  // upsert a connections row, then push the chat with that partner.
  const onConnect = async () => {
    if (!activeCandidate) return;
    thump();
    try {
      const userId = session?.user?.id;
      if (!userId) return;
      const { error } = await supabase
        .from('connections')
        .upsert(
          { user_id: userId, partner_id: activeCandidate.id },
          { onConflict: 'user_id,partner_id' },
        );
      if (error) {
        hError();
        return;
      }
      hSuccess();
      router.push(`/chat/${activeCandidate.id}`);
    } catch {
      hError();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false, title: 'Study Match' }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingBottom: insets.bottom + space.xl,
          paddingHorizontal: space.xl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TopBackBar onBack={() => router.back()} />

        <Header />

        {!eligibility.ready ? (
          <EligibilityBlocker
            message={eligibility.message ?? 'Complete your profile to use Study Match.'}
            onGo={() => {
              tap();
              router.push('/(tabs)/profile');
            }}
          />
        ) : phase === 'matching' && activeCandidate ? (
          <MatchingScreen candidate={activeCandidate} onCancel={backToBrowsing} />
        ) : phase === 'theater' && activeCandidate && sm.lastVerdict ? (
          <DialogueTheater
            candidate={activeCandidate}
            viewerName={sm.viewerProfile?.name ?? 'You'}
            viewerAvatarColor={sm.viewerProfile?.avatar_color ?? null}
            viewerAvatarEmoji={sm.viewerProfile?.avatar_emoji ?? null}
            viewerPhotoUrl={sm.viewerProfile?.photo_url ?? null}
            dialogue={sm.lastVerdict.dialogue}
            onComplete={() => setPhase('verdict')}
            onBack={backToBrowsing}
          />
        ) : phase === 'verdict' && activeCandidate && sm.lastVerdict ? (
          <VerdictView
            verdict={sm.lastVerdict}
            candidate={activeCandidate}
            viewerName={sm.viewerProfile?.name ?? 'You'}
            viewerAvatarColor={sm.viewerProfile?.avatar_color ?? null}
            viewerAvatarEmoji={sm.viewerProfile?.avatar_emoji ?? null}
            viewerPhotoUrl={sm.viewerProfile?.photo_url ?? null}
            onBack={backToBrowsing}
            onConnect={onConnect}
          />
        ) : (
          <>
            <TabBar tab={tab} onTab={t => { tap(); setTab(t); }} />

            {sm.error ? <ErrorBanner message={sm.error} /> : null}

            {tab === 'suggested' && (
              <SuggestedTab
                loading={sm.loading}
                candidates={sm.candidates}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onRetry={() => void sm.refresh()}
                onRunMatch={onRunMatch}
              />
            )}
            {tab === 'search' && (
              <SearchTab
                loading={sm.emailLookupLoading}
                result={sm.emailLookupResult}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onSearch={(email: string) => void sm.searchByEmail(email)}
                onClear={() => sm.clearEmailLookup()}
                onRunMatch={onRunMatch}
              />
            )}
            {tab === 'chats' && (
              <ChatsTab
                loading={sm.chatPartnersLoading}
                partners={sm.chatPartners}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onRetry={() => void sm.refreshChatPartners()}
                onRunMatch={onRunMatch}
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Header + back ─────────────────────────────────────────────────

function TopBackBar({ onBack }: { onBack: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onBack}
      style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ArrowLeft size={16} color={c.textMuted} strokeWidth={2} />
      <Text style={[styles.backText, { color: c.textMuted }]}>Back</Text>
    </Pressable>
  );
}

function Header() {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text style={[styles.h1, { color: c.text }]}>Study Match</Text>
      <View
        style={[
          styles.card,
          { backgroundColor: c.bgCard, borderColor: c.border, flexDirection: 'row', gap: space.md },
        ]}
      >
        <View
          style={{
            height: 36,
            width: 36,
            borderRadius: radius.md,
            backgroundColor: c.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Brain size={16} color={c.accent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.bodyText, { color: c.text }]}>
            Tony reads what we already know about you and another student, then
            talks to <Text style={{ fontStyle: 'italic' }}>their</Text> Tony to figure out if you two
            would actually study well together. You see the conversation as it
            happens — and then a verdict.
          </Text>
          <Text style={[styles.tiny, { color: c.textMuted }]}>
            No raw memories are shared between you. The AIs reason privately
            and surface only academic-fit conclusions.
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.tabBar, { borderColor: c.border, backgroundColor: c.bgElevated }]}>
      <TabPill active={tab === 'suggested'} onPress={() => onTab('suggested')}>
        <Sparkles size={12} color={tab === 'suggested' ? c.text : c.textMuted} strokeWidth={2} />
        <Text
          style={[
            styles.tabPillText,
            { color: tab === 'suggested' ? c.text : c.textMuted },
          ]}
        >
          Suggested
        </Text>
      </TabPill>
      <TabPill active={tab === 'search'} onPress={() => onTab('search')}>
        <Mail size={12} color={tab === 'search' ? c.text : c.textMuted} strokeWidth={2} />
        <Text
          style={[
            styles.tabPillText,
            { color: tab === 'search' ? c.text : c.textMuted },
          ]}
        >
          By email
        </Text>
      </TabPill>
      <TabPill active={tab === 'chats'} onPress={() => onTab('chats')}>
        <MessageSquare
          size={12}
          color={tab === 'chats' ? c.text : c.textMuted}
          strokeWidth={2}
        />
        <Text
          style={[
            styles.tabPillText,
            { color: tab === 'chats' ? c.text : c.textMuted },
          ]}
        >
          From chats
        </Text>
      </TabPill>
    </View>
  );
}

function TabPill({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabPill,
        {
          backgroundColor: active ? c.bgCard : 'transparent',
          borderColor: active ? c.border : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

// ── Suggested tab ─────────────────────────────────────────────────

function SuggestedTab({
  loading,
  candidates,
  matching,
  activeCandidateId,
  onRetry,
  onRunMatch,
}: {
  loading: boolean;
  candidates: CandidateRow[];
  matching: boolean;
  activeCandidateId: string | null;
  onRetry: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  const { c } = useTheme();
  if (loading) {
    return (
      <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
        <ActivityIndicator color={c.textMuted} />
      </View>
    );
  }
  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<Users2 size={22} color={c.textMuted} strokeWidth={2} />}
        title="No candidates near you yet"
        body="We look for students at your university in roughly your year, ranked by shared courses and major. As more students join from your campus, this list grows. Meanwhile, try By Email if you already know someone who's on Bas Udrus."
        action={{ label: 'Refresh', onPress: onRetry }}
      />
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.tiny, { color: c.textMuted }]}>
        {candidates.length} {candidates.length === 1 ? 'student' : 'students'} near you — best fits first
      </Text>
      <View style={{ gap: space.sm }}>
        {candidates.map(cand => (
          <CandidateRowView
            key={cand.id}
            c={cand}
            isActive={activeCandidateId === cand.id}
            disabled={matching && activeCandidateId !== cand.id}
            onRunMatch={() => onRunMatch(cand)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Search-by-email tab ───────────────────────────────────────────

function SearchTab({
  loading,
  result,
  matching,
  activeCandidateId,
  onSearch,
  onClear,
  onRunMatch,
}: {
  loading: boolean;
  result: CandidateRow | null;
  matching: boolean;
  activeCandidateId: string | null;
  onSearch: (email: string) => void;
  onClear: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  const { c } = useTheme();
  const [email, setEmail] = useState('');

  const submit = () => {
    if (!email.trim() || loading) return;
    onSearch(email.trim().toLowerCase());
  };

  return (
    <View style={{ gap: space.md }}>
      <View
        style={[
          styles.inputPill,
          { backgroundColor: c.bgElevated, borderColor: c.border },
        ]}
      >
        <Search size={14} color={c.textMuted} strokeWidth={2} />
        <TextInput
          value={email}
          onChangeText={t => {
            setEmail(t);
            if (result) onClear();
          }}
          onSubmitEditing={submit}
          placeholder="friend@example.com"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          returnKeyType="search"
          style={[styles.input, { color: c.text }]}
        />
        <Pressable
          onPress={submit}
          disabled={!email.trim() || loading}
          style={({ pressed }) => [
            styles.searchBtn,
            {
              backgroundColor: c.text,
              opacity: !email.trim() || loading ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={c.bg} size="small" />
          ) : (
            <Search size={13} color={c.bg} strokeWidth={2.5} />
          )}
          <Text style={[styles.searchBtnText, { color: c.bg }]}>
            {loading ? 'Searching' : 'Search'}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.tiny, { color: c.textMuted }]}>
        Look up a specific student by their Bas Udrus account email — works
        across universities and majors. We don't tell them they were searched.
        Limited to 10 lookups per hour to keep things polite.
      </Text>

      {result ? (
        <View style={{ gap: space.sm }}>
          <Text style={[styles.tiny, { color: c.textMuted }]}>Match found:</Text>
          <CandidateRowView
            c={result}
            isActive={activeCandidateId === result.id}
            disabled={matching && activeCandidateId !== result.id}
            onRunMatch={() => onRunMatch(result)}
          />
        </View>
      ) : !loading ? (
        <EmptyState
          icon={<UserPlus size={22} color={c.textMuted} strokeWidth={2} />}
          title="Know someone specifically?"
          body="Enter the email they signed up with — even if they're at a different university or major, you can still run an AI compatibility check."
        />
      ) : null}
    </View>
  );
}

// ── From-chats tab ────────────────────────────────────────────────

function ChatsTab({
  loading,
  partners,
  matching,
  activeCandidateId,
  onRetry,
  onRunMatch,
}: {
  loading: boolean;
  partners: CandidateRow[];
  matching: boolean;
  activeCandidateId: string | null;
  onRetry: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  const { c } = useTheme();
  if (loading) {
    return (
      <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
        <ActivityIndicator color={c.textMuted} />
      </View>
    );
  }
  if (partners.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare size={22} color={c.textMuted} strokeWidth={2} />}
        title="No chats yet"
        body="Start a conversation in Messages, then come back here to AI-match against people you already know."
        action={{ label: 'Reload', onPress: onRetry }}
      />
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.tiny, { color: c.textMuted }]}>
        {partners.length} {partners.length === 1 ? 'person' : 'people'} you've messaged
      </Text>
      <View style={{ gap: space.sm }}>
        {partners.map(p => (
          <CandidateRowView
            key={p.id}
            c={p}
            isActive={activeCandidateId === p.id}
            disabled={matching && activeCandidateId !== p.id}
            onRunMatch={() => onRunMatch(p)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Matching screen (API call in flight) ─────────────────────────

function MatchingScreen({
  candidate,
  onCancel,
}: {
  candidate: CandidateRow;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.bgCard, borderColor: c.border, alignItems: 'center', gap: space.md },
      ]}
    >
      <CandidateAvatar c={candidate} size={56} />
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={[styles.candidateName, { color: c.text }]}>{candidate.name}</Text>
        <Text style={[styles.tiny, { color: c.textMuted }]}>
          {[candidate.major, candidate.year ? `Year ${candidate.year}` : null]
            .filter(Boolean)
            .join(' · ') || candidate.uni}
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          marginTop: space.sm,
        }}
      >
        <ActivityIndicator color={c.accent} size="small" />
        <Text style={[styles.bodyText, { color: c.text }]}>
          Two Tonys are getting ready to talk…
        </Text>
      </View>
      <Pressable
        onPress={onCancel}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}
      >
        <Text style={[styles.tiny, { color: c.textMuted }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

// ── Dialogue theater ─────────────────────────────────────────────

const TYPING_MS = 800;
const POST_DIALOGUE_MS = 900;

function DialogueTheater({
  candidate,
  viewerName,
  viewerAvatarColor,
  viewerAvatarEmoji,
  viewerPhotoUrl,
  dialogue,
  onComplete,
  onBack,
}: {
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerAvatarEmoji: string | null;
  viewerPhotoUrl: string | null;
  dialogue: StudyMatchDialogueMessage[];
  onComplete: () => void;
  onBack: () => void;
}) {
  const { c } = useTheme();
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    if (shown >= dialogue.length) {
      const t = setTimeout(onComplete, POST_DIALOGUE_MS);
      return () => clearTimeout(t);
    }
    setTyping(true);
    const t = setTimeout(() => {
      setTyping(false);
      setShown(s => s + 1);
    }, TYPING_MS);
    return () => clearTimeout(t);
  }, [shown, dialogue.length, onComplete]);

  const nextSpeaker = dialogue[shown]?.speaker;

  return (
    <View style={{ gap: space.md }}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ArrowLeft size={12} color={c.textMuted} strokeWidth={2} />
        <Text style={[styles.tiny, { color: c.textMuted }]}>Cancel</Text>
      </Pressable>

      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
        <Text style={[styles.sectionEyebrow, { color: c.textMuted }]}>
          Two Tonys, comparing notes about you and{' '}
          {candidate.name.split(/\s+/)[0]}
        </Text>
        <View style={{ gap: space.md, marginTop: space.md }}>
          {dialogue.slice(0, shown).map((msg, i) => (
            <DialogueBubble
              key={`m-${i}`}
              msg={msg}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerAvatarEmoji={viewerAvatarEmoji}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          ))}
          {typing && shown < dialogue.length && (
            <DialogueBubble
              typing
              msg={{ speaker: nextSpeaker ?? 'tony_a', text: '' }}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerAvatarEmoji={viewerAvatarEmoji}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          )}
        </View>
        <Text
          style={[
            styles.tiny,
            { color: c.textMuted, textAlign: 'center', marginTop: space.md },
          ]}
        >
          {shown < dialogue.length ? 'Listening in…' : 'Verdict in a moment.'}
        </Text>
      </View>
    </View>
  );
}

/** Static (non-animated) version of the dialogue, used inside the
 *  verdict view so the user can re-read what the Tonys said. */
function DialogueTranscript({
  candidate,
  viewerName,
  viewerAvatarColor,
  viewerAvatarEmoji,
  viewerPhotoUrl,
  dialogue,
}: {
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerAvatarEmoji: string | null;
  viewerPhotoUrl: string | null;
  dialogue: StudyMatchDialogueMessage[];
}) {
  const { c } = useTheme();
  // Default-collapsed so the verdict cards remain the visual focus;
  // user taps the row to expand.
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
      <Pressable
        onPress={() => {
          tap();
          setOpen(v => !v);
        }}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={[styles.sectionEyebrow, { color: c.textMuted }]}>
          The conversation
        </Text>
        <Text style={[styles.tiny, { color: c.textMuted }]}>
          {open ? 'Hide' : `Show (${dialogue.length})`}
        </Text>
      </Pressable>
      {open && (
        <View style={{ gap: space.md, marginTop: space.md }}>
          {dialogue.map((msg, i) => (
            <DialogueBubble
              key={`t-${i}`}
              msg={msg}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerAvatarEmoji={viewerAvatarEmoji}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function DialogueBubble({
  msg,
  candidate,
  viewerName,
  viewerAvatarColor,
  viewerAvatarEmoji,
  viewerPhotoUrl,
  typing,
}: {
  msg: StudyMatchDialogueMessage;
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerAvatarEmoji: string | null;
  viewerPhotoUrl: string | null;
  typing?: boolean;
}) {
  const { c } = useTheme();
  const isCaller = msg.speaker === 'tony_a';
  const personName = isCaller ? viewerName : candidate.name;
  const personColor = isCaller ? viewerAvatarColor : candidate.avatar_color;
  const personPhoto = isCaller ? viewerPhotoUrl : candidate.photo_url;
  const personEmoji = isCaller ? viewerAvatarEmoji : null;

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        justifyContent: isCaller ? 'flex-start' : 'flex-end',
        alignItems: 'flex-start',
      }}
    >
      {isCaller && (
        <Avatar
          emoji={personEmoji}
          color={personColor}
          photoUrl={personPhoto}
          name={personName}
          size={28}
        />
      )}
      <View style={{ maxWidth: '76%', alignItems: isCaller ? 'flex-start' : 'flex-end' }}>
        <Text
          style={[
            styles.bubbleSpeaker,
            {
              color: isCaller ? c.accent : c.textMuted,
              textAlign: isCaller ? 'left' : 'right',
            },
          ]}
        >
          Tony · {personName.split(/\s+/)[0]}
          {isCaller ? ' (you)' : ''}
        </Text>
        <View
          style={[
            styles.bubble,
            isCaller
              ? { backgroundColor: c.accentSoft, borderTopLeftRadius: 6 }
              : { backgroundColor: c.bgElevated, borderTopRightRadius: 6 },
          ]}
        >
          {typing ? (
            <TypingDots />
          ) : (
            <Text style={[styles.bubbleText, { color: c.text }]}>{msg.text}</Text>
          )}
        </View>
      </View>
      {!isCaller && (
        <Avatar
          emoji={personEmoji}
          color={personColor}
          photoUrl={personPhoto}
          name={personName}
          size={28}
        />
      )}
    </View>
  );
}

/** Three-dot animated typing indicator. Uses Animated to keep the
 *  bounce smooth without pulling Reanimated in for one component. */
function TypingDots() {
  const { c } = useTheme();
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const cAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: -3,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 220,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    const loop = Animated.parallel([make(a, 0), make(b, 150), make(cAnim, 300)]);
    loop.start();
    return () => loop.stop();
  }, [a, b, cAnim]);

  const dotStyle = { backgroundColor: c.textMuted };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}>
      <Animated.View style={[styles.dot, dotStyle, { transform: [{ translateY: a }] }]} />
      <Animated.View style={[styles.dot, dotStyle, { transform: [{ translateY: b }] }]} />
      <Animated.View style={[styles.dot, dotStyle, { transform: [{ translateY: cAnim }] }]} />
    </View>
  );
}

// ── Verdict ──────────────────────────────────────────────────────

function VerdictView({
  verdict,
  candidate,
  viewerName,
  viewerAvatarColor,
  viewerAvatarEmoji,
  viewerPhotoUrl,
  onBack,
  onConnect,
}: {
  verdict: StudyMatchVerdict;
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerAvatarEmoji: string | null;
  viewerPhotoUrl: string | null;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ArrowLeft size={12} color={c.textMuted} strokeWidth={2} />
        <Text style={[styles.tiny, { color: c.textMuted }]}>Back</Text>
      </Pressable>

      {verdict.dialogue.length > 0 && (
        <DialogueTranscript
          candidate={candidate}
          viewerName={viewerName}
          viewerAvatarColor={viewerAvatarColor}
          viewerAvatarEmoji={viewerAvatarEmoji}
          viewerPhotoUrl={viewerPhotoUrl}
          dialogue={verdict.dialogue}
        />
      )}

      <VerdictCards verdict={verdict} candidate={candidate} onBack={onBack} onConnect={onConnect} />
    </View>
  );
}

type VerdictStyle = { label: string; bg: string; fg: string; ring: string };
function getVerdictStyle(
  verdict: StudyMatchVerdict['verdict'],
  c: ReturnType<typeof useTheme>['c'],
): VerdictStyle {
  switch (verdict) {
    case 'excellent':
      return {
        label: 'Excellent match',
        bg: 'rgba(52,199,89,0.12)',
        fg: '#16a34a',
        ring: 'rgba(52,199,89,0.32)',
      };
    case 'good':
      return {
        label: 'Good match',
        bg: c.accentSoft,
        fg: c.accent,
        ring: c.accent,
      };
    case 'fair':
      return {
        label: 'Fair match',
        bg: 'rgba(245,158,11,0.12)',
        fg: '#b45309',
        ring: 'rgba(245,158,11,0.30)',
      };
    case 'poor':
    default:
      return {
        label: 'Not a great fit',
        bg: 'rgba(0,0,0,0.06)',
        fg: c.textMuted,
        ring: c.border,
      };
  }
}

function VerdictCards({
  verdict,
  candidate,
  onBack,
  onConnect,
}: {
  verdict: StudyMatchVerdict;
  candidate: CandidateRow;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { c } = useTheme();
  const style = getVerdictStyle(verdict.verdict, c);
  const subtitle = [candidate.major, candidate.year ? `Year ${candidate.year}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ gap: space.md }}>
      {/* Top card — candidate + score badge + summary */}
      <View
        style={[
          styles.card,
          { backgroundColor: c.bgCard, borderColor: style.ring },
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            marginBottom: verdict.summary ? space.md : 0,
          }}
        >
          <CandidateAvatar c={candidate} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.candidateName, { color: c.text }]} numberOfLines={1}>
              {candidate.name}
            </Text>
            {subtitle ? (
              <Text style={[styles.tiny, { color: c.textMuted }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: style.bg,
            }}
          >
            <Sparkles size={11} color={style.fg} strokeWidth={2} />
            <Text style={{ color: style.fg, fontSize: 11, fontWeight: '700' }}>
              {verdict.score}/100 · {style.label}
            </Text>
          </View>
        </View>
        {verdict.summary ? (
          <Text style={[styles.bodyText, { color: c.text }]}>{verdict.summary}</Text>
        ) : null}
      </View>

      {verdict.strengths.length > 0 && (
        <VerdictListCard
          icon={<CheckCircle2 size={14} color="#16a34a" strokeWidth={2} />}
          title="Why this could work"
          items={verdict.strengths}
          bulletColor="#16a34a"
        />
      )}

      {verdict.concerns.length > 0 && (
        <VerdictListCard
          icon={<AlertCircle size={14} color="#b45309" strokeWidth={2} />}
          title="Things to know"
          items={verdict.concerns}
          bulletColor="#b45309"
        />
      )}

      {verdict.suggestedPlan ? (
        <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Heart size={14} color={c.accent} strokeWidth={2} />
            <Text style={[styles.sectionEyebrow, { color: c.textMuted }]}>
              If you study together
            </Text>
          </View>
          <Text style={[styles.bodyText, { color: c.text }]}>{verdict.suggestedPlan}</Text>
        </View>
      ) : null}

      {/* CTA row — Try another (secondary) + Send a study request (primary).
          Disabled when verdict is "poor" — matches the web's gating. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: space.sm,
          marginTop: space.sm,
        }}
      >
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.secondaryBtnText, { color: c.text }]}>Try another</Text>
        </Pressable>
        <Pressable
          onPress={onConnect}
          disabled={verdict.verdict === 'poor'}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: c.text,
              opacity: verdict.verdict === 'poor' ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <MessageSquare size={14} color={c.bg} strokeWidth={2.5} />
          <Text style={[styles.primaryBtnText, { color: c.bg }]}>
            Send a study request
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function VerdictListCard({
  icon,
  title,
  items,
  bulletColor,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  bulletColor: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm }}>
        {icon}
        <Text style={[styles.sectionEyebrow, { color: c.textMuted }]}>{title}</Text>
      </View>
      <View style={{ gap: 6 }}>
        {items.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ color: bulletColor, lineHeight: 20 }}>•</Text>
            <Text style={[styles.bodyText, { color: c.text, flex: 1 }]}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Shared bits ──────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: 'rgba(239,68,68,0.10)',
      }}
    >
      <AlertCircle size={14} color={c.danger} strokeWidth={2} style={{ marginTop: 2 }} />
      <Text style={[styles.bodyText, { color: c.danger, flex: 1 }]}>{message}</Text>
    </View>
  );
}

function EligibilityBlocker({
  message,
  onGo,
}: {
  message: string;
  onGo: () => void;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.bgCard, borderColor: c.border, alignItems: 'center', gap: space.sm },
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.lg,
          backgroundColor: c.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}
      >
        <AlertCircle size={20} color={c.accent} strokeWidth={2} />
      </View>
      <Text style={[styles.candidateName, { color: c.text }]}>
        A few profile bits missing
      </Text>
      <Text style={[styles.tiny, { color: c.textMuted, textAlign: 'center' }]}>
        {message}
      </Text>
      <Pressable
        onPress={onGo}
        style={({ pressed }) => [
          styles.primaryBtn,
          { backgroundColor: c.text, opacity: pressed ? 0.85 : 1, marginTop: space.sm },
        ]}
      >
        <Text style={[styles.primaryBtnText, { color: c.bg }]}>Go to Profile</Text>
      </Pressable>
    </View>
  );
}

function CandidateRowView({
  c,
  isActive,
  disabled,
  onRunMatch,
}: {
  c: CandidateRow;
  isActive: boolean;
  disabled: boolean;
  onRunMatch: () => void;
}) {
  const { c: t } = useTheme();
  const subtitle = [c.major, c.year ? `Year ${c.year}` : null].filter(Boolean).join(' · ');
  const sharedCount = c.sharedSubjects ?? 0;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.bgCard,
          borderColor: t.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.md,
        },
      ]}
    >
      <CandidateAvatar c={c} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.candidateName, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>
            {c.name || 'Student'}
          </Text>
          {sharedCount > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: radius.pill,
                backgroundColor: t.accentSoft,
              }}
            >
              <BookOpen size={9} color={t.accent} strokeWidth={2} />
              <Text style={{ color: t.accent, fontSize: 10, fontWeight: '700' }}>
                {sharedCount} shared
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.tiny, { color: t.textMuted }]} numberOfLines={1}>
          {subtitle || c.uni}
        </Text>
      </View>
      <Pressable
        onPress={onRunMatch}
        disabled={disabled || isActive}
        style={({ pressed }) => [
          styles.runBtn,
          isActive
            ? { backgroundColor: t.accentSoft }
            : { backgroundColor: t.text },
          { opacity: disabled || isActive ? (isActive ? 1 : 0.4) : pressed ? 0.85 : 1 },
        ]}
      >
        {isActive ? (
          <>
            <Loader2 size={11} color={t.accent} strokeWidth={2} />
            <Text style={[styles.runBtnText, { color: t.accent }]}>Tonys talking…</Text>
          </>
        ) : (
          <>
            <Sparkles size={11} color={t.bg} strokeWidth={2} />
            <Text style={[styles.runBtnText, { color: t.bg }]}>Run AI match</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function CandidateAvatar({ c, size = 40 }: { c: CandidateRow; size?: number }) {
  // Avatar component already handles photo / fallback for us. We
  // pass name so the initial-letter fallback renders correctly when
  // the candidate has no photo + no emoji on file.
  return (
    <Avatar
      color={c.avatar_color}
      photoUrl={c.photo_mode === 'photo' ? c.photo_url : null}
      name={c.name}
      size={size}
    />
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.sm }}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.lg,
          backgroundColor: c.bgElevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Text style={[styles.candidateName, { color: c.text, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[styles.tiny, { color: c.textMuted, textAlign: 'center', maxWidth: 320 }]}>
        {body}
      </Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [
            {
              paddingHorizontal: space.lg,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: c.bgElevated,
              borderWidth: 1,
              borderColor: c.border,
              opacity: pressed ? 0.7 : 1,
              marginTop: space.xs,
            },
          ]}
        >
          <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// Touch the TONY_PURPLE constant so the linter doesn't strip it — it
// stays here in case we want to color-key icons across the screen
// later without re-exporting from theme.
void TONY_PURPLE;

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: { fontSize: 13, fontWeight: '500' },

  h1: {
    fontSize: 30,
    lineHeight: 36,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    letterSpacing: -0.6,
  },

  card: {
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },

  bodyText: {
    fontSize: font.sizes.sm,
    lineHeight: 20,
  },
  tiny: {
    fontSize: 12,
    lineHeight: 16,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Tabs
  tabBar: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: 2,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tabPillText: { fontSize: 12, fontWeight: '600' },

  // Search
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0, height: 36 },
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
  },
  searchBtnText: { fontSize: 12, fontWeight: '600' },

  // Candidate row
  candidateName: { fontSize: 14, fontWeight: '600' },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
  },
  runBtnText: { fontSize: 11, fontWeight: '600' },

  // Bubble
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleSpeaker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  bubbleText: { fontSize: 13, lineHeight: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },

  // CTAs
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
  },
  primaryBtnText: { fontSize: 13, fontWeight: '600' },
  secondaryBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '500' },
});
