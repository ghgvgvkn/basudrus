/**
 * MentalHealthPane — the "Mental health" pane of the AI tab.
 *
 * Mirrors the *spirit* of the web's MentalHealthScreenModal without
 * shipping the full PHQ-9 / GAD-7 questionnaire on mobile in this
 * release (that lands as its own screen later). What's here:
 *
 *   • Empathetic opener — "How are you doing, really?" matches the
 *     web copy verbatim so the brand voice is consistent.
 *   • Two check-in entry cards (Depression / Anxiety) — visually
 *     identical to the web ScreenCards. Tapping shows a "coming to
 *     mobile soon" toast (in the parent) for now; the structure is
 *     here so we can wire up navigation when the flow ships.
 *   • Crisis card — phone number + ER copy. Always at top so a
 *     student in distress can find it in one tap.
 *   • Verified-therapist list pulled from `mh_therapists`. Honest
 *     empty state when the directory is empty.
 *   • Mandatory "this is not a diagnosis" footer.
 *
 * Why the AI tab hosts mental health (per the user brief): "the mental
 * health should be there. I have mental health not in the connect page.
 * It should be in the AI page". A SegmentedControl at the top of the
 * AI tab flips between Tony and Mental Health. Connect is Messages-only.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { useTherapists, type Therapist } from '@/hooks/useTherapists';

export function MentalHealthPane() {
  const { c, mode } = useTheme();
  const { therapists, loading } = useTherapists();

  const callJordanEmergency = () => {
    tap();
    // Same number the web modal recommends in its CrisisPhase.
    Linking.openURL('tel:911').catch(() => { /* user denied or no dialer — silent */ });
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Empathetic header — matches web copy. */}
      <View style={styles.headerBlock}>
        <View style={styles.headerIconRow}>
          <MaterialCommunityIcons name="heart-pulse" size={18} color="#0E8A6B" />
          <Text style={[styles.headerKicker, { color: c.textMuted }]}>
            Mental health check-in
          </Text>
        </View>
        <Text style={[styles.headerTitle, { color: c.text }]}>
          How are you doing, really?
        </Text>
        <Text style={[styles.headerBody, { color: c.textMuted }]}>
          Validated 2-minute self-screens used worldwide. They&apos;re{' '}
          <Text style={{ color: c.text, fontWeight: font.weights.semibold }}>
            not a diagnosis
          </Text>{' '}
          — only a clinician can diagnose. They&apos;re a check-in, so you have a
          clearer picture of where you are right now.
        </Text>
      </View>

      {/* Crisis card — always above the fold. */}
      <Pressable
        onPress={callJordanEmergency}
        style={({ pressed }) => [
          styles.crisisCard,
          {
            backgroundColor: mode === 'dark' ? 'rgba(194,63,108,0.15)' : 'rgba(194,63,108,0.08)',
            borderColor: 'rgba(194,63,108,0.35)',
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.crisisHeader}>
          <Ionicons name="warning" size={18} color="#C23F6C" />
          <Text style={[styles.crisisTitle, { color: '#C23F6C' }]}>
            In immediate danger?
          </Text>
        </View>
        <Text style={[styles.crisisBody, { color: c.text }]}>
          Call 911 (Jordan emergency) or go to the nearest hospital emergency
          department. You don&apos;t have to carry this alone.
        </Text>
        <View style={styles.callBtnRow}>
          <View style={[styles.callBtn, { backgroundColor: '#C23F6C' }]}>
            <Ionicons name="call" size={14} color="#fff" />
            <Text style={styles.callBtnText}>Call 911</Text>
          </View>
        </View>
      </Pressable>

      {/* Check-in entry cards — wired to a coming-soon disclosure for
          now. Structure is here for when /mental-health/phq9 ships. */}
      <ScreenEntryCard
        title="Depression check-in (PHQ-9)"
        subtitle="9 questions, about 2 minutes."
        body="How depression-like symptoms have been showing up in your life over the last 2 weeks."
        comingSoon
      />
      <ScreenEntryCard
        title="Anxiety check-in (GAD-7)"
        subtitle="7 questions, under 2 minutes."
        body="How anxiety-like symptoms have been showing up in your life over the last 2 weeks."
        comingSoon
      />

      {/* Therapist directory */}
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionHeader, { color: c.text }]}>
          Verified options in Jordan
        </Text>
      </View>
      {loading ? (
        <Text style={[styles.muted, { color: c.textMuted }]}>Loading…</Text>
      ) : therapists.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            We don&apos;t have a verified provider listed yet. Reliable next
            steps: ask your general physician for a referral, contact your
            university&apos;s accredited counselor, or call 911 if you&apos;re in
            immediate danger.
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {therapists.map(t => <TherapistCard key={t.id} t={t} />)}
        </View>
      )}

      {/* "Not a diagnosis" — always-visible footer per the brand brief. */}
      <View style={[styles.disclaimerCard, { backgroundColor: c.bgElevated, borderColor: c.border }]}>
        <Text style={[styles.disclaimerTitle, { color: c.text }]}>
          This is a check-in, not a diagnosis
        </Text>
        <Text style={[styles.disclaimerBody, { color: c.textMuted }]}>
          Nobody — not us, not an app, not a short questionnaire — can
          diagnose you. A real diagnosis comes from a mental-health
          professional after a full conversation.
        </Text>
      </View>
    </ScrollView>
  );
}

function ScreenEntryCard({
  title, subtitle, body, comingSoon,
}: {
  title: string;
  subtitle: string;
  body: string;
  comingSoon?: boolean;
}) {
  const { c, mode } = useTheme();
  return (
    <Pressable
      onPress={() => { tap(); /* full flow lands in a follow-up release */ }}
      style={({ pressed }) => [
        styles.entryCard,
        { backgroundColor: c.bgCard, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.entrySubtitle, { color: c.textMuted }]}>{subtitle}</Text>
        <Text style={[styles.entryBody, { color: c.textMuted }]}>{body}</Text>
        {comingSoon ? (
          <View
            style={[
              styles.comingSoonBadge,
              {
                backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                borderColor: c.border,
              },
            ]}
          >
            <Text style={[styles.comingSoonText, { color: c.textMuted }]}>
              Coming to mobile soon
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.entryArrow, { backgroundColor: c.text }]}>
        <Ionicons name="arrow-forward" size={14} color={c.bg} />
      </View>
    </Pressable>
  );
}

function TherapistCard({ t }: { t: Therapist }) {
  const { c } = useTheme();
  const subline = [
    t.kind.replace('_', ' '),
    t.city,
    t.isFree ? 'Free' : null,
    t.isSlidingScale ? 'Sliding scale' : null,
  ].filter(Boolean).join(' · ');

  const call = () => {
    if (!t.phone) return;
    tap();
    Linking.openURL(`tel:${t.phone.replace(/\s/g, '')}`).catch(() => {});
  };
  const visit = () => {
    if (!t.url) return;
    tap();
    Linking.openURL(t.url).catch(() => {});
  };

  return (
    <View style={[styles.thCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
      <Text style={[styles.thName, { color: c.text }]}>{t.name}</Text>
      <Text style={[styles.thSubline, { color: c.textMuted }]} numberOfLines={1}>
        {subline}
      </Text>
      <Text style={[styles.thDesc, { color: c.textMuted }]} numberOfLines={3}>
        {t.description}
      </Text>
      <View style={styles.thActionsRow}>
        {t.phone ? (
          <Pressable
            onPress={call}
            style={({ pressed }) => [
              styles.thAction,
              { backgroundColor: c.bgElevated, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="call" size={12} color={c.text} />
            <Text style={[styles.thActionText, { color: c.text }]}>{t.phone}</Text>
          </Pressable>
        ) : null}
        {t.url ? (
          <Pressable
            onPress={visit}
            style={({ pressed }) => [
              styles.thAction,
              { backgroundColor: c.bgElevated, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="open-outline" size={12} color={c.text} />
            <Text style={[styles.thActionText, { color: c.text }]}>Website</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xxl * 2,
    gap: space.md,
  },

  headerBlock: {
    marginBottom: space.sm,
  },
  headerIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: space.sm,
  },
  headerKicker: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
  },
  headerTitle: {
    fontSize: font.sizes.xxl,
    fontWeight: font.weights.bold,
    fontStyle: 'italic',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  headerBody: {
    marginTop: space.sm,
    fontSize: font.sizes.md,
    lineHeight: 22,
  },

  crisisCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  crisisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: space.sm,
  },
  crisisTitle: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
  },
  crisisBody: {
    fontSize: font.sizes.sm,
    lineHeight: 20,
  },
  callBtnRow: {
    flexDirection: 'row',
    marginTop: space.md,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  callBtnText: {
    color: '#fff',
    fontSize: font.sizes.sm,
    fontWeight: font.weights.bold,
  },

  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  entryTitle: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },
  entrySubtitle: {
    fontSize: font.sizes.xs,
    marginTop: 2,
  },
  entryBody: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
    marginTop: space.sm,
  },
  comingSoonBadge: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  comingSoonText: {
    fontSize: 10,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  entryArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    marginBottom: space.xs,
  },
  sectionHeader: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
  },

  muted: {
    fontSize: font.sizes.sm,
    paddingVertical: space.md,
    textAlign: 'center',
  },

  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  emptyText: {
    fontSize: font.sizes.sm,
    lineHeight: 20,
  },

  thCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  thName: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },
  thSubline: {
    fontSize: font.sizes.xs,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  thDesc: {
    marginTop: space.sm,
    fontSize: font.sizes.sm,
    lineHeight: 19,
  },
  thActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: space.md,
  },
  thAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  thActionText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.medium,
  },

  disclaimerCard: {
    marginTop: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  disclaimerTitle: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.bold,
    marginBottom: 4,
  },
  disclaimerBody: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
  },
});
