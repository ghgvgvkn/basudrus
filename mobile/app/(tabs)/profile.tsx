/**
 * Profile v7.2 — uni / major / year are now pickers, not free text.
 *
 * v7.2 changes — user feedback: "on the universities and the profile
 * it should be connected to the universities that we have, not any
 * university. The one we have in the data, same thing goes for the
 * major, same thing goes for the year, and same thing does NOT go
 * for the bio. So when somebody posts for help it's gonna be
 * connected to the Discover page". Three pickers, plus a check that
 * Post-for-help still surfaces in Discover:
 *   - University now reads from the same `useUniversities()` catalog
 *     the onboarding + Discover filter use (≈600 rows from the
 *     `universities` table). Searchable list inside the edit modal;
 *     tap a row → save the canonical NAME to `profiles.uni`. No more
 *     "PSUT" vs "Princess Sumaya University for Technology" drift
 *     that would silently break the Discover `uni ilike '%…%'` filter.
 *   - Major reads from `useMajors(uniId)` — filtered to the user's
 *     uni when we can resolve one, otherwise the global catalog
 *     (deduped). Same canonical-name save into `profiles.major`.
 *   - Year is a fixed 6-row picker (Year 1, 2, 3, 4, 5+, Graduate)
 *     mapping to the discrete enum `1|2|3|4|5|grad` that
 *     `useDiscoverFeed`'s `.eq('year', f.year)` expects. Typing "year 3"
 *     into the old free-text input never matched the Discover filter
 *     value of "3" — same root cause as the uni drift.
 *   - Bio stays a TextInput (user explicitly excluded bio).
 * Post-for-help (`/post-help`) already inserts into `help_requests`
 * with the right FK, and `useDiscoverFeed` joins via
 * `fk_help_requests_user` and tiers askers first — so no changes
 * were needed to the post path. The fix here just ensures the
 * profile values the Discover filters JOIN against are canonical.
 *
 * v7.1 changes — bug fix the user reported: "When I edit things on
 * the profile for example, name major or whatever they don't get
 * saved". Two compounding root causes:
 *   - `.update().eq()` without `.select().single()` returns
 *     `{ error: null }` even when ZERO rows match (RLS mismatch, or
 *     a missing profile row). The success path then optimistically
 *     updated local state, the modal closed, the user thought it
 *     saved — but nothing was written. Pull-to-refresh restored
 *     the old value.
 *   - The text columns (`name`, `uni`, `major`, `year`, `bio`) are
 *     `text NOT NULL DEFAULT ''::text`. Sending `null` when the user
 *     cleared a field rejected with a constraint violation — which
 *     DID surface, but caused intermittent "saves work but clears
 *     don't" confusion.
 * Fix: send empty string for clears (respects NOT NULL), append
 * `.select().single()` to surface 0-row matches as a real error,
 * and add a defensive `upsert` fallback that seeds the row on
 * PGRST116 (mirrors the web's useRealProfile.ts "ensure row exists"
 * defense in case the handle_new_user trigger didn't fire for this
 * account).
 *
 * v7 changes (per user: "delete the streak in the XP and the subject
 * process and replace with the box from the the homepage of the
 * streak just copy paste it to the same thing"):
 *   - REMOVED: 2-column Streak (flame) + XP (trophy) stat-card duo.
 *   - REMOVED: SubjectProgressGrid card (subject mastery rings).
 *   - ADDED: Direct copy of the Home screen's "Streak + XP" bento
 *     card — single unified surface with the animated flame
 *     number, "days in a row" copy, XP block on the right, an
 *     XPBar level progress strip, and a "Post for help" primary CTA
 *     wired to /post-help. Same `useGameTracking` live values the
 *     Home card reads, combined with the persisted profile row via
 *     Math.max so the on-screen value can only ever go UP from what
 *     the user last saw.
 *
 * v6.1: restored the labelled PREFERENCES / ACCOUNT / ABOUT settings
 * groups beneath the hero/stats. Terms / Privacy open
 * https://www.basudrus.com/terms|privacy via `Linking.openURL`.
 *
 * Screen order (top → bottom):
 *   1. Header — centered "Profile" title.
 *   2. Hero card — avatar + italic serif name + Major · Year · Uni
 *      meta + bio + subject chips + pencil-edit button.
 *   3. Streak bento card — copy of Home's streak surface (NEW v7).
 *   4. Study partners — placeholder card.
 *   5. Personality quiz — clipboard icon + label → /quiz.
 *   6. Pro card — Upgrade CTA (free) or "Pro · active" card (pro).
 *   7. PREFERENCES — Study reminders · App theme · Calendar · Reminders.
 *   8. ACCOUNT — Plan · Email · App version.
 *   9. ABOUT — Terms · Privacy · Rate.
 *  10. Sign out — centered text button with logout icon.
 *
 * The per-field edit modal and avatar source sheet stay as-is —
 * mobile-native patterns that beat the website's inline form on a
 * touchscreen. Photo upload via expo-image-picker → Supabase storage,
 * Calendar + Reminders via lib/calendarSync, theme picker via
 * ThemeContext, pull-to-refresh — all retained from v5/v6.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { XPBar } from '@/components/XPBar';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { thump, tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme, type ThemePref } from '@/context/ThemeContext';
import { uploadAvatar, clearAvatarPhoto } from '@/lib/uploadAvatar';
import { useMatchScores } from '@/hooks/useMatchScores';
import { useGameTracking } from '@/hooks/useGameTracking';
import { useUniversities, useMajors } from '@/hooks/useUniversities';
import {
  addEvent as calAddEvent,
  addReminder as calAddReminder,
  ensureCalendarPermission,
  ensureReminderPermission,
  getCalendarPermissionStatus,
  getReminderPermissionStatus,
} from '@/lib/calendarSync';

type EditableField = 'name' | 'uni' | 'major' | 'year' | 'bio';

type ProfileRow = {
  name: string | null;
  uni: string | null;
  major: string | null;
  year: string | null;
  bio: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
  photo_url: string | null;
  xp: number | null;
  streak: number | null;
  pro: boolean | null;
  subjects: string[] | null;
};

// Friendly labels for the edit modal — keeps the placeholder/heading
// readable instead of saying "Edit uni".
const FIELD_LABEL: Record<EditableField, string> = {
  name: 'Name',
  uni: 'University',
  major: 'Major',
  year: 'Year',
  bio: 'About you',
};

const FIELD_PLACEHOLDER: Record<EditableField, string> = {
  name: 'Your name',
  uni: 'e.g. Princess Sumaya University',
  major: 'e.g. Computer Science',
  year: 'e.g. 3',
  bio: 'A line or two about how you study, what you like, …',
};

// Year picker rows. Stored values MUST stay in sync with what the
// Discover filter expects (`.eq('year', value)` in useDiscoverFeed.ts
// — values: '1', '2', '3', '4', '5', 'grad'). Display labels are
// human-friendly; storage stays canonical.
const YEAR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1',    label: 'Year 1' },
  { value: '2',    label: 'Year 2' },
  { value: '3',    label: 'Year 3' },
  { value: '4',    label: 'Year 4' },
  { value: '5',    label: 'Year 5+' },
  { value: 'grad', label: 'Graduate / Postgrad' },
];

// The website's italic serif marquee — `Georgia` is the closest
// system serif on iOS / Android that ships with both regular + italic
// faces, no custom font shipping required. We use the same family for
// the hero name and stat-card numbers so the type rhythm matches the
// web design.
const SERIF = 'Georgia';

// Fallback brand color used as the avatar background when the user
// has no `avatar_color` saved. Same value the website uses.
const DEFAULT_AVATAR_COLOR = '#5B4BF5';

export default function ProfileScreen() {
  const { c, mode, userPref, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, signOut } = useAuth();
  // `hasQuiz` flips the quiz card subtitle so a returning user knows
  // they're refining their answers, not starting from scratch.
  const { hasQuiz } = useMatchScores();
  // Live XP + streak — same source the Home screen's streak bento
  // card reads. Combined with the persisted profile values via
  // Math.max below so the on-screen number can only ever go UP from
  // what was last saved (defensive against in-flight updates).
  const { xp: liveXp, streak: liveStreak } = useGameTracking();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Catalog hooks for the uni/major pickers — same source the
  // onboarding form and the Discover filter pull from, so what the
  // user picks here matches what Discover filters against. Major list
  // is filtered to the currently saved uni when we can resolve its
  // catalog row by name; otherwise we show the global list.
  const { unis: universityCatalog } = useUniversities();
  const resolvedUniId = useMemo(() => {
    const cur = (profile?.uni ?? '').trim().toLowerCase();
    if (!cur) return null;
    return universityCatalog.find(u => u.name.trim().toLowerCase() === cur)?.id ?? null;
  }, [profile?.uni, universityCatalog]);
  const { majors: majorCatalog } = useMajors(resolvedUniId);

  // Picker search query (lives next to editingField — gets cleared
  // every time the modal opens for a fresh search experience).
  const [pickerQuery, setPickerQuery] = useState('');

  // Avatar-related modals.
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Field-edit modal + the "which field do you want to edit?" picker.
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  // Imperative ref on the edit TextInput. `autoFocus` is unreliable
  // inside iOS pageSheet modals — the modal animates in, the input
  // mounts, but the keyboard doesn't always pop until the user taps
  // the input. We explicitly focus() shortly after the modal opens
  // to guarantee the keyboard rises on first try. That's the "I have
  // to tap on it again to make it work" half of the bug the user
  // reported on the name save flow.
  const editInputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    if (editingField !== 'name' && editingField !== 'bio') return;
    // 240ms covers both the slide-in (~200ms on iOS pageSheet) and
    // gives a margin for the input to mount. Earlier focus calls
    // race with the animation and the keyboard never shows.
    const t = setTimeout(() => editInputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [editingField]);

  // Theme sheet.
  const [showThemeSheet, setShowThemeSheet] = useState(false);

  // Local-only prefs.
  const [notifs, setNotifs] = useState(true);

  // Privacy opt-ins (persisted to profiles). Default false = privacy-safe;
  // hydrated below. See sql/20260530_match_privacy_optins.sql.
  const [studyMatchOptIn, setStudyMatchOptIn] = useState(false);
  const [discoverableByEmail, setDiscoverableByEmail] = useState(false);

  // Calendar + Reminders integration status. We read on mount (no
  // prompt) so the rows show "Connected" vs "Connect" without asking
  // for permission until the user opts in.
  const [calStatus, setCalStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [remStatus, setRemStatus] = useState<'granted' | 'denied' | 'undetermined' | 'unsupported'>('undetermined');
  const [showCalSheet, setShowCalSheet] = useState(false);
  const [showRemSheet, setShowRemSheet] = useState(false);

  const anim = useRef(new Animated.Value(0)).current;
  // Flame "breathing" loop on the streak number — same gentle 1.0 ↔
  // 1.18 scale loop the Home screen uses on its streak bento card.
  const flame = useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('name, uni, major, year, bio, avatar_emoji, avatar_color, photo_url, xp, streak, pro, subjects')
      .eq('id', session.user.id)
      .maybeSingle();
    setProfile(data as ProfileRow | null);
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  // Read calendar + reminders permission status once on mount. These
  // calls do NOT prompt — they just inspect the existing grant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cal, rem] = await Promise.all([
        getCalendarPermissionStatus().catch(() => 'undetermined' as const),
        getReminderPermissionStatus().catch(() => 'undetermined' as const),
      ]);
      if (cancelled) return;
      setCalStatus(cal);
      setRemStatus(rem);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [anim]);

  // Flame loop on the streak number. Identical pattern to the Home
  // screen's streak bento card — keeps the type pulsing gently so the
  // card feels alive when the user lands on Profile.
  useEffect(() => {
    const flameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flame, { toValue: 1.18, duration: 650, useNativeDriver: true }),
        Animated.timing(flame, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    flameLoop.start();
    return () => flameLoop.stop();
  }, [flame]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Load privacy opt-ins separately + defensively, so a missing column
  // (before sql/20260530_match_privacy_optins.sql is applied) can never
  // break the main profile load above.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('study_match_opt_in, discoverable_by_email')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled || error || !data) return;
      setStudyMatchOptIn((data as { study_match_opt_in?: boolean }).study_match_opt_in === true);
      setDiscoverableByEmail((data as { discoverable_by_email?: boolean }).discoverable_by_email === true);
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  /** Persist a privacy opt-in toggle (optimistic, reverts on failure). */
  const updatePrivacyFlag = useCallback(async (
    column: 'study_match_opt_in' | 'discoverable_by_email',
    value: boolean,
  ) => {
    const uid = session?.user?.id;
    if (!uid) return;
    tap();
    if (column === 'study_match_opt_in') setStudyMatchOptIn(value);
    else setDiscoverableByEmail(value);
    const { error } = await supabase.from('profiles').update({ [column]: value }).eq('id', uid);
    if (error) {
      // Revert on failure (e.g. column missing pre-migration).
      if (column === 'study_match_opt_in') setStudyMatchOptIn(!value);
      else setDiscoverableByEmail(!value);
    }
  }, [session?.user?.id]);

  // ─── Field editing ───────────────────────────────────────────────
  const startEdit = (field: EditableField, current: string | null) => {
    tap();
    setShowEditSheet(false);
    setEditingField(field);
    setEditValue(current ?? '');
    setPickerQuery('');
  };

  const saveField = async (field: EditableField, value: string) => {
    if (!session?.user?.id) return;
    setSaving(true);
    const trimmed = value.trim();
    const uid = session.user.id;

    // CRITICAL: the profiles table defines name/uni/major/year/bio as
    // `text NOT NULL DEFAULT ''::text`, so sending `null` when the
    // user clears a field rejects with a constraint violation. Send
    // empty string instead — that's the schema's "missing" value.
    //
    // We also append `.select().single()` so a 0-row match (e.g. RLS
    // mismatch, or a missing profile row) surfaces as a PGRST116
    // error instead of returning success silently. The previous
    // pattern `.update().eq()` returned `{ error: null }` even when
    // nothing was written — which is exactly the "edits don't save"
    // bug the user hit.
    const { data, error } = await supabase
      .from('profiles')
      .update({ [field]: trimmed })
      .eq('id', uid)
      .select()
      .single();

    // Fallback: if the row genuinely doesn't exist (handle_new_user
    // trigger didn't fire, or the profile was deleted), seed it now
    // with the edited field set. Mirrors the web's useRealProfile.ts
    // "ensure row exists" defense.
    if (error && (error.code === 'PGRST116' || /no rows/i.test(error.message))) {
      const { data: seeded, error: seedErr } = await supabase
        .from('profiles')
        .upsert({ id: uid, [field]: trimmed }, { onConflict: 'id' })
        .select()
        .single();
      setSaving(false);
      if (seedErr) {
        Alert.alert("Couldn't save", seedErr.message);
        return;
      }
      setProfile(seeded as ProfileRow);
      setEditingField(null);
      return;
    }

    setSaving(false);
    if (error) {
      Alert.alert("Couldn't save", error.message);
      return;
    }
    // Merge the freshly persisted row back into local state so what
    // we render is exactly what the server stored (no drift between
    // optimistic state and the DB).
    setProfile(prev => (prev ? { ...prev, ...(data as ProfileRow) } : (data as ProfileRow)));
    setEditingField(null);
  };

  // ─── Avatar: photo (camera or library) ───────────────────────────
  const pickFromLibrary = async () => {
    setShowAvatarSheet(false);
    if (!session?.user?.id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      // New string-array form (`MediaTypeOptions.Images` is deprecated
      // in expo-image-picker 17). 'images' restricts to still photos.
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await runUpload(result.assets[0]);
  };

  const takePhoto = async () => {
    setShowAvatarSheet(false);
    if (!session?.user?.id) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a picture.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await runUpload(result.assets[0]);
  };

  const runUpload = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!session?.user?.id) return;
    setUploadingPhoto(true);
    const res = await uploadAvatar(session.user.id, {
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize ?? null,
    });
    setUploadingPhoto(false);
    if (!res.ok) {
      Alert.alert("Couldn't upload", res.error);
      return;
    }
    thump();
    // Optimistic flip so the new pic shows instantly, THEN refresh
    // from the server to be sure what the user sees matches what was
    // actually persisted. This is the second half of the "press
    // again to make it stick" fix — without this, a successful
    // upload could still be silently reverted on the next refresh
    // because optimistic state and server state weren't reconciled.
    setProfile(prev => (prev ? { ...prev, photo_url: res.url } : prev));
    await load();
  };

  const removePhoto = async () => {
    setShowAvatarSheet(false);
    if (!session?.user?.id) return;
    const res = await clearAvatarPhoto(session.user.id);
    if (!res.ok) {
      Alert.alert("Couldn't update", res.error);
      return;
    }
    // Same pattern as runUpload: optimistic flip + server reload so
    // the clear is reconciled with what was actually persisted.
    setProfile(prev => (prev ? { ...prev, photo_url: null } : prev));
    await load();
  };

  // ─── Theme ───────────────────────────────────────────────────────
  const pickTheme = (next: ThemePref) => {
    tap();
    setMode(next);
    setShowThemeSheet(false);
  };

  // ─── Calendar + Reminders ────────────────────────────────────────
  const connectCalendar = async () => {
    tap();
    setShowCalSheet(false);
    const perm = await ensureCalendarPermission();
    setCalStatus(perm);
    if (perm !== 'granted') {
      Alert.alert(
        'Calendar access denied',
        'You can enable Calendar access for Bas Udrus in iOS Settings → Privacy → Calendars.',
      );
      return;
    }
    const start = new Date(Date.now() + 30 * 60 * 1000); // 30 min from now
    const res = await calAddEvent({
      title: 'Bas Udrus — sample study session',
      start,
      end: new Date(start.getTime() + 60 * 60 * 1000),
      notes: 'This is a sample event added when you connected your calendar to Bas Udrus. You can delete it.',
      alarmOffsetMin: 15,
    });
    if (res.kind === 'ok') {
      thump();
      Alert.alert(
        'Calendar connected',
        'We added a sample study session 30 minutes from now. New Bas Udrus events will drop into your "Bas Udrus" calendar.',
      );
    } else if (res.kind === 'error') {
      Alert.alert("Couldn't add event", res.message);
    }
  };

  const connectReminders = async () => {
    tap();
    setShowRemSheet(false);
    if (Platform.OS !== 'ios') {
      Alert.alert(
        'iOS only',
        'Apple Reminders integration is iOS-only. On Android we use the Calendar entry above to schedule alerts.',
      );
      return;
    }
    const perm = await ensureReminderPermission();
    if (perm === 'unsupported') return;
    setRemStatus(perm);
    if (perm !== 'granted') {
      Alert.alert(
        'Reminders access denied',
        'You can enable Reminders access for Bas Udrus in iOS Settings → Privacy → Reminders.',
      );
      return;
    }
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const res = await calAddReminder({
      title: 'Bas Udrus — sample study reminder',
      dueDate: due,
      notes: 'Sample reminder added when you connected Bas Udrus to Apple Reminders. You can delete it.',
    });
    if (res.kind === 'ok') {
      thump();
      Alert.alert(
        'Reminders connected',
        'We added a sample reminder for 1 hour from now in your "Bas Udrus" list.',
      );
    } else if (res.kind === 'error') {
      Alert.alert("Couldn't add reminder", res.message);
    }
  };

  // ─── Sign out ────────────────────────────────────────────────────
  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          thump();
          await signOut();
        },
      },
    ]);
  };

  // ─── Derived ─────────────────────────────────────────────────────
  // Combine live (in-flight) and persisted (from /profiles) values
  // with Math.max so a value can only ever go UP from what the user
  // last saw — same defensive merge the Home screen uses.
  const xp = Math.max(liveXp, profile?.xp ?? 0);
  const streak = Math.max(liveStreak, profile?.streak ?? 0);
  const isPro = profile?.pro === true;
  const photoUrl = profile?.photo_url ?? null;
  const name = profile?.name ?? session?.user?.email?.split('@')[0] ?? 'You';
  const emoji = profile?.avatar_emoji ?? '🙂';
  const avatarColor = profile?.avatar_color ?? DEFAULT_AVATAR_COLOR;
  // Initials are an option if the user has no photo + no emoji. Right
  // now mobile rows always seed `avatar_emoji`, but if it's ever null
  // we fall back to the website's initials pattern.
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
  // Meta subtitle on the hero card. Same join the website uses so
  // the order reads identically on both surfaces.
  const meta = [
    profile?.major ?? null,
    profile?.year ? `Year ${profile.year}` : null,
    profile?.uni ?? null,
  ].filter(Boolean).join(' · ') || 'Tell us about yourself';
  const subjects = Array.isArray(profile?.subjects) ? profile?.subjects ?? [] : [];
  const themeLabel =
    userPref === 'light'
      ? 'Light'
      : userPref === 'dark'
        ? 'Dark'
        : 'System default';

  return (
    <>
      <ScrollView
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 110,
          gap: space.md,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.textMuted}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: c.text }]}>Profile</Text>
        </View>

        {/* ─── Hero card ─── */}
        <Animated.View
          style={{
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          <View style={[styles.heroCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={styles.heroRow}>
              <Pressable
                onPress={() => { tap(); setShowAvatarSheet(true); }}
                style={styles.avatarPress}
                accessibilityRole="button"
                accessibilityLabel={photoUrl ? 'Change profile photo' : 'Upload profile photo'}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: photoUrl ? 'transparent' : avatarColor, borderColor: c.border },
                  ]}
                >
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.avatarImage} />
                  ) : profile?.avatar_emoji ? (
                    <Text style={styles.avatarEmoji}>{emoji}</Text>
                  ) : (
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  )}
                  {uploadingPhoto ? (
                    <View style={styles.avatarOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : null}
                </View>
                <View style={[styles.avatarCamera, { backgroundColor: c.bgElevated, borderColor: c.border }]}>
                  <Ionicons name="camera" size={12} color={c.text} />
                </View>
              </Pressable>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[styles.heroName, { color: c.text }]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                <Text
                  style={[styles.heroMeta, { color: c.textMuted }]}
                  numberOfLines={2}
                >
                  {meta}
                </Text>
              </View>

              <Pressable
                onPress={() => { tap(); setShowEditSheet(true); }}
                style={({ pressed }) => [
                  styles.pencilBtn,
                  {
                    borderColor: c.border,
                    backgroundColor: c.bgElevated,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
              >
                <Ionicons name="pencil" size={16} color={c.text} />
              </Pressable>
            </View>

            {profile?.bio ? (
              <Text style={[styles.heroBio, { color: c.textMuted }]}>
                {profile.bio}
              </Text>
            ) : null}

            {subjects.length > 0 ? (
              <View style={styles.subjectChips}>
                {subjects.map((s) => (
                  <View
                    key={s}
                    style={[
                      styles.subjectChip,
                      { backgroundColor: c.bgElevated, borderColor: c.border },
                    ]}
                  >
                    <Text style={[styles.subjectChipText, { color: c.textMuted }]}>{s}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </Animated.View>

        {/* ─── Streak + XP bento card ───────────────────────────────
            Direct copy of the Home screen's streak bento card. Per
            the user brief ("delete the streak in the XP and the
            subject process and replace with the box from the
            homepage of the streak just copy paste it to the same
            thing"), the two side-by-side stat cards and the
            SubjectProgressGrid are gone — replaced by this single
            unified card so Profile and Home tell the streak story
            the same way. CTA still routes to /post-help. */}
        <View style={[styles.streakBento, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <View style={styles.eyebrowRow}>
            <Ionicons name="flame" size={13} color={c.textMuted} />
            <Text style={[styles.eyebrowText, { color: c.textMuted }]}>STREAK</Text>
          </View>
          <View style={styles.streakRow}>
            <Animated.Text
              style={[
                styles.streakNumber,
                { color: c.text, transform: [{ scale: flame }] },
              ]}
            >
              {streak}
            </Animated.Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.streakLabel, { color: c.text }]}>days in a row.</Text>
              <Text style={[styles.streakSub, { color: c.textMuted }]}>Keep it going.</Text>
            </View>
            <View style={[styles.xpBlock, { borderColor: c.border }]}>
              <Text style={[styles.xpNumber, { color: c.text }]}>
                <AnimatedNumber value={xp} />
              </Text>
              <Text style={[styles.xpLabel, { color: c.textMuted }]}>XP</Text>
            </View>
          </View>
          <View style={{ marginTop: space.sm }}>
            <XPBar xp={xp} />
          </View>
          <Pressable
            onPress={() => { thump(); router.push('/post-help'); }}
            style={({ pressed }) => [
              styles.streakCta,
              { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="add" size={14} color={mode === 'dark' ? '#000' : '#fff'} />
            <Text style={[styles.streakCtaText, { color: mode === 'dark' ? '#000' : '#fff' }]}>
              Post for help
            </Text>
          </Pressable>
        </View>

        {/* ─── Study partners ─── */}
        <View style={[styles.section, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <Text style={[styles.sectionTitleSerif, { color: c.text }]}>Study partners</Text>
          <Text style={[styles.sectionBody, { color: c.textMuted }]}>
            No partners yet. Find some in Discover.
          </Text>
        </View>

        {/* ─── Personality quiz ─── */}
        <Pressable
          onPress={() => { tap(); router.push('/quiz'); }}
          style={({ pressed }) => [
            styles.quizCard,
            {
              backgroundColor: c.bgCard,
              borderColor: c.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open personality quiz"
        >
          <View style={[styles.quizIcon, { backgroundColor: c.accentSoft }]}>
            <Ionicons name="clipboard-outline" size={20} color={c.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.quizTitle, { color: c.text }]}>Personality quiz</Text>
            <Text style={[styles.quizSub, { color: c.textMuted }]} numberOfLines={2}>
              {hasQuiz
                ? '11 questions that drive your match %. Update anytime.'
                : 'Take the 11-question quiz to unlock match scores. +25 XP.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
        </Pressable>

        {/* ─── Pro / Upgrade card ─── */}
        {isPro ? (
          <Pressable
            onPress={() => { tap(); Alert.alert('You are Pro', 'Thanks for supporting Bas Udrus!'); }}
            style={({ pressed }) => [
              styles.proActiveCard,
              {
                backgroundColor: c.bgCard,
                borderColor: c.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.quizIcon, { backgroundColor: c.accentSoft }]}>
              <Ionicons name="infinite" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.quizTitle, { color: c.text }]}>
                Bas Udrus Pro · active
              </Text>
              <Text style={[styles.quizSub, { color: c.textMuted }]}>
                Manage billing, payment, renewal
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => { thump(); router.push('/upgrade'); }}
            style={({ pressed }) => [
              styles.upgradeDarkCard,
              {
                // Always dark — same as the website's "upgrade" card.
                // In dark mode, push it a notch darker than the surface
                // so it still reads as an emphasised CTA.
                backgroundColor: mode === 'dark' ? '#050505' : '#0e0e10',
                opacity: pressed ? 0.92 : 1,
              },
            ]}
          >
            <View style={styles.upgradeIcon}>
              <Ionicons name="sparkles" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
              <Text style={styles.upgradeSub}>
                Unlimited AI, voice messages, file uploads, priority matching. JD 3.99/mo.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
        )}

        {/* ─── Preferences (Study reminders + Theme + Calendar + Reminders) ─── */}
        <SectionLabel>PREFERENCES</SectionLabel>
        <View style={[styles.groupCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <ToggleRow
            label="Study reminders"
            value={notifs}
            onToggle={(v) => { tap(); setNotifs(v); }}
          />
          <ActionRow
            label="App theme"
            value={themeLabel}
            onPress={() => { tap(); setShowThemeSheet(true); }}
          />
          <ActionRow
            label="Calendar"
            value={
              calStatus === 'granted'
                ? 'Connected'
                : calStatus === 'denied'
                  ? 'Denied'
                  : 'Connect'
            }
            onPress={() => { tap(); setShowCalSheet(true); }}
          />
          <ActionRow
            label="Reminders"
            value={
              remStatus === 'unsupported'
                ? 'iOS only'
                : remStatus === 'granted'
                  ? 'Connected'
                  : remStatus === 'denied'
                    ? 'Denied'
                    : 'Connect'
            }
            onPress={() => { tap(); setShowRemSheet(true); }}
            last
          />
        </View>

        {/* ─── Privacy ─── */}
        <SectionLabel>PRIVACY</SectionLabel>
        <View style={[styles.groupCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <ToggleRow
            label="Use my notes for Study Match"
            value={studyMatchOptIn}
            onToggle={(v) => { void updatePrivacyFlag('study_match_opt_in', v); }}
          />
          <ToggleRow
            label="Findable by email"
            value={discoverableByEmail}
            onToggle={(v) => { void updatePrivacyFlag('discoverable_by_email', v); }}
            last
          />
        </View>

        {/* ─── Account ─── */}
        <SectionLabel>ACCOUNT</SectionLabel>
        <View style={[styles.groupCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <ActionRow
            label="Plan"
            value={isPro ? 'Pro' : 'Free'}
            onPress={() => {
              tap();
              if (isPro) {
                Alert.alert('You are Pro', 'Thanks for supporting Bas Udrus!');
              } else {
                router.push('/upgrade');
              }
            }}
          />
          <InfoRow label="Email" value={session?.user?.email ?? '—'} />
          <InfoRow label="App version" value="0.1.0" last />
        </View>

        {/* ─── About ─── */}
        <SectionLabel>ABOUT</SectionLabel>
        <View style={[styles.groupCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <ActionRow
            label="Terms of Service"
            value=""
            onPress={() => {
              tap();
              Linking.openURL('https://www.basudrus.com/terms').catch(() => {});
            }}
          />
          <ActionRow
            label="Privacy Policy"
            value=""
            onPress={() => {
              tap();
              Linking.openURL('https://www.basudrus.com/privacy').catch(() => {});
            }}
          />
          <ActionRow
            label="Rate the app"
            value="⭐️⭐️⭐️⭐️⭐️"
            onPress={() => {
              tap();
              Alert.alert(
                'Rate Bas Udrus',
                "Thanks for considering it! We'll open the App Store rating sheet once we're live on TestFlight.",
              );
            }}
            last
          />
        </View>

        {/* ─── Sign out ─── */}
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={16} color={c.textMuted} />
          <Text style={[styles.signOutText, { color: c.textMuted }]}>Sign out</Text>
        </Pressable>
      </ScrollView>

      {/* ─── Edit field modal ─── */}
      {/* Modal swaps its inner body based on field type:
              - name / bio  → free text input (multiline for bio)
              - uni         → searchable list of catalog universities
              - major       → searchable list of catalog majors
                              (filtered to the user's saved uni when
                              we can resolve it, otherwise global)
              - year        → 6 tappable rows (1, 2, 3, 4, 5+, Grad)
                              that store the discrete enum value the
                              Discover filter expects. */}
      <Modal
        visible={editingField !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingField(null)}
      >
        <View style={[styles.editModal, { backgroundColor: c.bg }]}>
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.editTitle, { color: c.text }]}>
            {editingField ? FIELD_LABEL[editingField] : ''}
          </Text>

          {editingField === 'name' || editingField === 'bio' ? (
            // ── Free text path (name + bio) ──────────────────────
            <>
              <TextInput
                ref={editInputRef}
                value={editValue}
                onChangeText={setEditValue}
                // `autoFocus` is kept as a hint for accessibility
                // tooling but the imperative focus() above is what
                // reliably opens the keyboard on iOS pageSheet
                // modals (where autoFocus is racy with the slide-in).
                autoFocus
                multiline={editingField === 'bio'}
                numberOfLines={editingField === 'bio' ? 4 : 1}
                maxLength={editingField === 'bio' ? 300 : 80}
                style={[
                  styles.editInput,
                  {
                    color: c.text,
                    backgroundColor: c.bgCard,
                    borderColor: c.border,
                    minHeight: editingField === 'bio' ? 110 : undefined,
                    textAlignVertical: editingField === 'bio' ? 'top' : 'center',
                  },
                ]}
                placeholderTextColor={c.textFaint}
                placeholder={editingField ? FIELD_PLACEHOLDER[editingField] : ''}
                returnKeyType={editingField === 'bio' ? 'default' : 'done'}
                onSubmitEditing={() => {
                  if (editingField && editingField !== 'bio') {
                    saveField(editingField, editValue);
                  }
                }}
              />
              <View style={styles.editButtons}>
                <Pressable
                  onPress={() => setEditingField(null)}
                  style={[styles.editBtn, { backgroundColor: c.bgCard, borderColor: c.border, borderWidth: 1 }]}
                >
                  <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: font.sizes.md }}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => editingField && saveField(editingField, editValue)}
                  style={[styles.editBtn, { backgroundColor: c.accent }]}
                  disabled={saving}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: font.sizes.md }}>
                    {saving ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : editingField === 'year' ? (
            // ── Year picker ──────────────────────────────────────
            // Discover filters on year with `.eq('year', value)` so
            // the values MUST match the canonical enum exactly:
            // '1' | '2' | '3' | '4' | '5' | 'grad'.
            <>
              <Text style={[styles.pickerHelp, { color: c.textMuted }]}>
                Pick the year you&apos;re currently in.
              </Text>
              <View style={{ gap: space.sm }}>
                {YEAR_OPTIONS.map(opt => {
                  const sel = (profile?.year ?? '') === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        if (saving) return;
                        // Save immediately on tap — the picker is the
                        // commit action. Same UX as iOS picker rows.
                        void saveField('year', opt.value);
                      }}
                      style={({ pressed }) => [
                        styles.yearOption,
                        {
                          backgroundColor: sel ? c.accentSoft : c.bgCard,
                          borderColor: sel ? c.accent : c.border,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.yearOptionLabel, { color: c.text }]}>
                        {opt.label}
                      </Text>
                      {sel ? (
                        <Ionicons name="checkmark-circle" size={20} color={c.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => setEditingField(null)}
                style={[styles.editBtn, { backgroundColor: c.bgCard, borderColor: c.border, borderWidth: 1, marginTop: space.md }]}
              >
                <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: font.sizes.md }}>
                  Done
                </Text>
              </Pressable>
            </>
          ) : (
            // ── Uni / Major picker (searchable list) ─────────────
            <CatalogPicker
              kind={editingField === 'uni' ? 'uni' : 'major'}
              query={pickerQuery}
              onQueryChange={setPickerQuery}
              currentValue={
                editingField === 'uni'
                  ? profile?.uni ?? ''
                  : profile?.major ?? ''
              }
              options={
                editingField === 'uni'
                  ? universityCatalog.map(u => ({ id: u.id, name: u.name }))
                  : majorCatalog.map(m => ({ id: m.id, name: m.name }))
              }
              onPick={(name) => {
                if (!editingField || saving) return;
                void saveField(editingField, name);
              }}
              onClose={() => setEditingField(null)}
              saving={saving}
            />
          )}
        </View>
      </Modal>

      {/* ─── Edit-profile picker sheet ─── */}
      <Modal
        visible={showEditSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowEditSheet(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>Edit profile</Text>
          <Text style={[styles.sheetSub, { color: c.textMuted }]}>
            Pick what you want to update. Each field saves on its own.
          </Text>

          <EditFieldButton label="Name" value={profile?.name} onPress={() => startEdit('name', profile?.name ?? null)} />
          <EditFieldButton label="University" value={profile?.uni} onPress={() => startEdit('uni', profile?.uni ?? null)} />
          <EditFieldButton label="Major" value={profile?.major} onPress={() => startEdit('major', profile?.major ?? null)} />
          <EditFieldButton label="Year" value={profile?.year} onPress={() => startEdit('year', profile?.year ?? null)} />
          <EditFieldButton label="Bio" value={profile?.bio} onPress={() => startEdit('bio', profile?.bio ?? null)} />

          <SheetButton
            icon="close"
            label="Done"
            onPress={() => setShowEditSheet(false)}
            tint={c.textMuted}
            bg={c.bgElevated}
            border={c.border}
          />
        </View>
      </Modal>

      {/* ─── Avatar source sheet ─── */}
      <Modal
        visible={showAvatarSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAvatarSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowAvatarSheet(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>Change photo</Text>
          <Text style={[styles.sheetSub, { color: c.textMuted }]}>
            A real photo helps people recognise you in Discover and chats.
          </Text>

          <SheetButton icon="camera" label="Take photo" onPress={takePhoto} tint={c.text} bg={c.bgCard} border={c.border} />
          <SheetButton icon="image" label="Choose from library" onPress={pickFromLibrary} tint={c.text} bg={c.bgCard} border={c.border} />
          {photoUrl ? (
            <SheetButton icon="trash" label="Remove photo" onPress={removePhoto} tint={c.danger} bg={c.bgCard} border={c.border} />
          ) : null}
          <SheetButton icon="close" label="Cancel" onPress={() => setShowAvatarSheet(false)} tint={c.textMuted} bg={c.bgElevated} border={c.border} />
        </View>
      </Modal>

      {/* ─── Theme sheet ─── */}
      <Modal
        visible={showThemeSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowThemeSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowThemeSheet(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>App theme</Text>
          <Text style={[styles.sheetSub, { color: c.textMuted }]}>
            Bas Udrus defaults to light. Choose what you like best.
          </Text>

          <ThemeChoice label="Light" sub="Bright background, dark text" icon="sunny" selected={userPref === 'light'} onPress={() => pickTheme('light')} />
          <ThemeChoice label="Dark" sub="Easier on the eyes at night" icon="moon" selected={userPref === 'dark'} onPress={() => pickTheme('dark')} />
          <ThemeChoice label="System default" sub="Follow your phone's setting" icon="phone-portrait" selected={userPref === 'system'} onPress={() => pickTheme('system')} />

          <SheetButton icon="close" label="Done" onPress={() => setShowThemeSheet(false)} tint={c.textMuted} bg={c.bgElevated} border={c.border} />
        </View>
      </Modal>

      {/* ─── Calendar connect sheet ─── */}
      <Modal
        visible={showCalSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCalSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowCalSheet(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>Connect Calendar</Text>
          <Text style={[styles.sheetSub, { color: c.textMuted }]}>
            Bas Udrus will create a dedicated &quot;Bas Udrus&quot; calendar in your phone.
            Group rooms and study sessions you join from the app drop into it
            automatically — and you can hide or delete the calendar anytime
            from your phone&apos;s Calendar settings.
          </Text>

          <SheetButton
            icon="calendar"
            label={calStatus === 'granted' ? 'Add a test event' : 'Connect Calendar'}
            onPress={connectCalendar}
            tint={c.text}
            bg={c.bgCard}
            border={c.border}
          />
          <SheetButton icon="close" label="Cancel" onPress={() => setShowCalSheet(false)} tint={c.textMuted} bg={c.bgElevated} border={c.border} />
        </View>
      </Modal>

      {/* ─── Reminders connect sheet ─── */}
      <Modal
        visible={showRemSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRemSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowRemSheet(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>Connect Reminders</Text>
          <Text style={[styles.sheetSub, { color: c.textMuted }]}>
            {Platform.OS === 'ios'
              ? 'Bas Udrus will create a "Bas Udrus" list in Apple Reminders. We\'ll drop a reminder for each study session you schedule. You can mute or delete the list anytime.'
              : 'Apple Reminders is iOS-only. On Android use the Calendar entry above to get alerts before your sessions.'}
          </Text>

          {Platform.OS === 'ios' ? (
            <SheetButton
              icon="checkmark-circle"
              label={remStatus === 'granted' ? 'Add a test reminder' : 'Connect Reminders'}
              onPress={connectReminders}
              tint={c.text}
              bg={c.bgCard}
              border={c.border}
            />
          ) : null}
          <SheetButton icon="close" label="Close" onPress={() => setShowRemSheet(false)} tint={c.textMuted} bg={c.bgElevated} border={c.border} />
        </View>
      </Modal>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      style={[styles.sectionLabel, { color: c.textMuted }]}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

function EditFieldButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string | null | undefined;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.editFieldBtn,
        { borderColor: c.border, backgroundColor: c.bgCard, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.editFieldLabel, { color: c.textMuted }]}>{label}</Text>
        <Text
          style={[styles.editFieldValue, { color: c.text }]}
          numberOfLines={1}
        >
          {value?.trim() || '—'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
    </Pressable>
  );
}

function ActionRow({
  label,
  value,
  onPress,
  last = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, { color: c.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
      </View>
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
    >
      <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: c.textMuted }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
  last = false,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
    >
      <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: c.bgElevated, true: c.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

function SheetButton({
  icon,
  label,
  onPress,
  tint,
  bg,
  border,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tint: string;
  bg: string;
  border: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetBtn,
        { backgroundColor: bg, borderColor: border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={[styles.sheetBtnText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * CatalogPicker — searchable list of universities or majors.
 *
 * Renders a search box on top of a scrollable FlatList of catalog
 * rows. Tapping a row commits via `onPick(name)` (parent calls
 * saveField). The currently-selected row gets a check pill so the
 * user knows what's saved without having to scroll for it.
 *
 * Filter: case-insensitive `includes` on the row name. Cheap enough
 * for the ~600-row uni catalog. Empty state shows a "no matches"
 * line so the user knows the catalog is loaded — without it an empty
 * FlatList looks like a hung modal.
 */
function CatalogPicker({
  kind,
  query,
  onQueryChange,
  currentValue,
  options,
  onPick,
  onClose,
  saving,
}: {
  kind: 'uni' | 'major';
  query: string;
  onQueryChange: (q: string) => void;
  currentValue: string;
  options: Array<{ id: string; name: string }>;
  onPick: (name: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { c } = useTheme();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const currentLower = currentValue.trim().toLowerCase();
  const placeholder =
    kind === 'uni' ? 'Search universities…' : 'Search majors…';

  return (
    <View style={{ flex: 1, gap: space.md }}>
      <Text style={[styles.pickerHelp, { color: c.textMuted }]}>
        {kind === 'uni'
          ? 'Pick your university so other students at your school can find you.'
          : 'Pick your major — Discover uses this to match you with students in the same field.'}
      </Text>
      <View
        style={[
          styles.pickerSearchWrap,
          { backgroundColor: c.bgCard, borderColor: c.border },
        ]}
      >
        <Ionicons name="search" size={16} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          autoFocus
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.pickerSearch, { color: c.text }]}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => onQueryChange('')} hitSlop={6}>
            <Ionicons name="close-circle" size={18} color={c.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
        )}
        ListEmptyComponent={
          <Text style={[styles.pickerEmpty, { color: c.textMuted }]}>
            No matches. Try a different search.
          </Text>
        }
        renderItem={({ item }) => {
          const sel = item.name.trim().toLowerCase() === currentLower;
          return (
            <Pressable
              onPress={() => onPick(item.name)}
              disabled={saving}
              style={({ pressed }) => [
                styles.pickerRow,
                {
                  backgroundColor: pressed ? c.bgElevated : 'transparent',
                  opacity: saving ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.pickerRowText,
                  { color: c.text, fontWeight: sel ? '700' : '500' },
                ]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              {sel ? (
                <Ionicons name="checkmark-circle" size={20} color={c.accent} />
              ) : null}
            </Pressable>
          );
        }}
      />

      <Pressable
        onPress={onClose}
        style={[
          styles.editBtn,
          { backgroundColor: c.bgCard, borderColor: c.border, borderWidth: 1 },
        ]}
      >
        <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: font.sizes.md }}>
          {saving ? 'Saving…' : 'Done'}
        </Text>
      </Pressable>
    </View>
  );
}

function ThemeChoice({
  label,
  sub,
  icon,
  selected,
  onPress,
}: {
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.themeChoice,
        {
          backgroundColor: selected ? c.accentSoft : c.bgCard,
          borderColor: selected ? c.accent : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.themeIconWrap, { backgroundColor: selected ? c.accent : c.bgElevated }]}>
        <Ionicons name={icon} size={18} color={selected ? '#fff' : c.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.themeChoiceLabel, { color: c.text }]}>{label}</Text>
        <Text style={[styles.themeChoiceSub, { color: c.textMuted }]}>{sub}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={c.accent} />
      ) : (
        <View style={[styles.themeRadio, { borderColor: c.border, backgroundColor: c.bgElevated }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  headerTitle: {
    fontSize: font.sizes.lg,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },

  // Hero card
  heroCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.lg,
  },
  avatarPress: { position: 'relative' },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEmoji: { fontSize: 42 },
  avatarInitials: {
    fontSize: 28,
    fontWeight: font.weights.semibold,
    color: '#fff',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCamera: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  heroName: {
    fontSize: 26,
    fontFamily: SERIF,
    fontStyle: 'italic',
    letterSpacing: -0.4,
  },
  heroMeta: {
    fontSize: font.sizes.sm,
    marginTop: 4,
    lineHeight: 19,
  },
  heroBio: {
    fontSize: font.sizes.sm,
    lineHeight: 21,
  },
  pencilBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectChip: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  subjectChipText: {
    fontSize: 11.5,
    fontWeight: font.weights.medium,
  },

  // ── Streak bento card (copied from Home) ───────────────────────
  // Same `bentoCard` shape used on the Home screen — single unified
  // card containing the eyebrow row, big italic flame number, "days
  // in a row" copy, XP block on the right, XPBar, and "Post for
  // help" CTA. Visual parity with Home is deliberate; we want the
  // streak surface to read identically wherever the user finds it.
  streakBento: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: space.sm,
  },
  eyebrowText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  streakNumber: {
    fontSize: 56,
    lineHeight: 60,
    fontStyle: 'italic',
    fontFamily: SERIF,
    letterSpacing: -1.4,
  },
  streakLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },
  streakSub: {
    fontSize: font.sizes.sm,
    marginTop: 1,
  },
  xpBlock: {
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  xpNumber: {
    fontSize: 18,
    fontWeight: font.weights.bold,
  },
  xpLabel: {
    fontSize: 10,
    fontWeight: font.weights.bold,
    letterSpacing: 0.5,
  },
  streakCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    marginTop: space.md,
  },
  streakCtaText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    letterSpacing: 0.3,
  },

  // Generic section card
  section: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.lg,
  },

  // Labelled section header — small caps muted text. Used above the
  // grouped settings/account/about cards so the screen scans like a
  // proper settings list (matches Apple's HIG and the old v5 chrome
  // the user wanted back). Padded with a bit of top space + small
  // negative bottom margin so the label hugs the card it labels.
  sectionLabel: {
    fontSize: 11,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: space.md,
    marginBottom: -space.xs,
    paddingHorizontal: space.sm,
  },

  // Grouped rounded card holding ActionRow / ToggleRow / InfoRow
  // children. Same shape as `section` but with 0 vertical padding so
  // the rows touch the card edge — the rows handle their own padding.
  groupCard: {
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  sectionTitleSerif: {
    fontSize: font.sizes.lg,
    fontFamily: SERIF,
    fontStyle: 'italic',
    letterSpacing: -0.2,
    marginBottom: space.sm,
  },
  sectionBody: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
  },

  // Quiz / Pro-active card (same shape — icon + title + sub + chevron)
  quizCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  quizIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quizTitle: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },
  quizSub: {
    fontSize: font.sizes.sm,
    marginTop: 2,
    lineHeight: 18,
  },

  // Pro-active mirrors the quiz card shape
  proActiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.lg,
  },

  // Upgrade dark CTA (free tier)
  upgradeDarkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  upgradeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  upgradeTitle: {
    fontSize: 22,
    fontFamily: SERIF,
    fontStyle: 'italic',
    color: '#fff',
    letterSpacing: -0.3,
  },
  upgradeSub: {
    fontSize: font.sizes.sm,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 4,
    lineHeight: 18,
  },

  // Settings rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  rowLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.medium,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    justifyContent: 'flex-end',
  },
  rowValue: {
    fontSize: font.sizes.md,
    maxWidth: '70%',
    textAlign: 'right',
  },

  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    marginTop: space.sm,
  },
  signOutText: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
  },

  // Edit modal (per-field input)
  editModal: { flex: 1, padding: space.xl, paddingTop: space.lg, gap: space.lg },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.md,
  },
  editTitle: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
    letterSpacing: -0.3,
  },
  editInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: font.sizes.lg,
  },
  editButtons: { flexDirection: 'row', gap: space.md },
  editBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Catalog picker (uni / major) ───────────────────────────────
  pickerHelp: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
    marginTop: -space.sm,
  },
  pickerSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  pickerSearch: {
    flex: 1,
    fontSize: font.sizes.md,
    paddingVertical: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pickerRowText: {
    fontSize: font.sizes.md,
    flex: 1,
    minWidth: 0,
  },
  pickerEmpty: {
    fontSize: font.sizes.sm,
    textAlign: 'center',
    paddingVertical: space.xl,
  },

  // ── Year picker rows ───────────────────────────────────────────
  yearOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  yearOptionLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },

  // Edit-field picker rows (inside the edit sheet)
  editFieldBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  editFieldLabel: {
    fontSize: 11,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  editFieldValue: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.medium,
    marginTop: 2,
  },

  // Bottom sheets
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    gap: space.sm,
  },
  sheetTitle: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
    letterSpacing: -0.3,
    marginTop: space.xs,
  },
  sheetSub: {
    fontSize: font.sizes.sm,
    marginBottom: space.md,
    lineHeight: 18,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  sheetBtnText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },

  // Theme choice rows
  themeChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  themeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeChoiceLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
  },
  themeChoiceSub: {
    fontSize: font.sizes.sm,
    marginTop: 2,
  },
  themeRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
});
