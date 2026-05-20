/**
 * NotificationsSection — email preferences (the live ones) + future channels.
 *
 * The Sunday Letter unsubscribe flag is a real column on profiles
 * (letter_unsubscribed) — the weekly cron at api/cron/sunday-letter.ts
 * skips users with this set to true. Other channels (push, SMS) are
 * marked Coming Soon honestly rather than rendered as dead toggles.
 */
import { useEffect, useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { Group, Row, Switch, Tag, Note } from "./parts";

export function NotificationsSection() {
  const { user } = useSupabaseSession();
  const [letterUnsub, setLetterUnsub] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.id) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("letter_unsubscribed")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setErr(error.message);
      else setLetterUnsub(Boolean(data?.letter_unsubscribed));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [user?.id]);

  const toggleSundayLetter = async () => {
    if (!user?.id || letterUnsub === null) return;
    const next = !letterUnsub;
    setLetterUnsub(next);
    setSaving(true);
    setErr("");
    const { error } = await supabase
      .from("profiles")
      .update({ letter_unsubscribed: next })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      // Optimistic rollback
      setLetterUnsub(!next);
    }
  };

  // "Subscribed" = letter_unsubscribed is FALSE. The double negative
  // is annoying but it's the schema. We surface it as a positive
  // toggle: "Receive the Sunday letter" ON ↔ letter_unsubscribed FALSE.
  const sundayLetterOn = letterUnsub === null ? false : !letterUnsub;

  return (
    <>
      <Group title="Email">
        <Row
          label="Sunday letter"
          hint="A weekly personalised recap of your study activity, written by Tony Starrk. Sent every Sunday morning."
          action={
            loading
              ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
              : <Switch on={sundayLetterOn} onToggle={toggleSundayLetter} ariaLabel="Sunday letter" />
          }
        />
        <Row
          label="New match alerts"
          hint="Email me when someone on Bas Udrus matches my profile (course + university + meet preference)."
          action={
            <span className="inline-flex items-center gap-2">
              <Tag>Coming soon</Tag>
              <Switch on={false} onToggle={() => { /* TODO */ }} ariaLabel="Match alerts" />
            </span>
          }
        />
        <Row
          label="Direct messages"
          hint="Email when a study partner sends you a message and you're away."
          action={
            <span className="inline-flex items-center gap-2">
              <Tag>Coming soon</Tag>
              <Switch on={false} onToggle={() => { /* TODO */ }} ariaLabel="DM emails" />
            </span>
          }
        />
      </Group>

      <Group title="Push (browser)">
        <Row
          label="Browser notifications"
          hint="Pings for new matches, room invites, and Tony's proactive nudges."
          action={
            <span className="inline-flex items-center gap-2">
              <Tag>Coming soon</Tag>
              <Switch on={false} onToggle={() => { /* TODO */ }} ariaLabel="Push notifications" />
            </span>
          }
        />
      </Group>

      <Group title="SMS / WhatsApp">
        <Row
          label="Urgent reminders only"
          hint="Only for exam-eve study plans and Concierge Mode (Studio tier)."
          action={
            <span className="inline-flex items-center gap-2">
              <Tag>Coming soon</Tag>
              <Switch on={false} onToggle={() => { /* TODO */ }} ariaLabel="SMS alerts" />
            </span>
          }
        />
      </Group>

      {err && <Note tone="warn">Couldn't save: {err}</Note>}
      {saving && <p className="text-xs text-ink-3 px-1 mb-3">Saving…</p>}

      <Note tone="info">
        <span className="inline-flex items-start gap-1.5">
          <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>All email is sent to <strong>{user?.email ?? "your account email"}</strong>. Change your email in Account → Identity.</span>
        </span>
      </Note>

    </>
  );
}
