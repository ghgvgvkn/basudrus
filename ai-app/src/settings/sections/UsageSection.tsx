/**
 * UsageSection — real activity counters pulled from ai_usage.
 *
 * Schema: ai_usage (id, user_id, endpoint, created_at). Each row =
 * one AI request. We aggregate client-side because volumes per user
 * are tiny (hundreds of rows max). For heavy users we'd move this
 * to a SECURITY DEFINER RPC; not necessary yet.
 *
 * Today's count drives the free-tier message limit display. Endpoints
 * are mapped to friendly names (tutor → Tony Starrk, wellbeing →
 * Sherlock, study-plan / match → artifacts).
 */
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Calendar, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { Group, Note } from "./parts";

interface UsageRow { endpoint: string; created_at: string }
interface UsageStats {
  today: number;
  week: number;
  month: number;
  total: number;
  byEndpoint: Record<string, number>;
}

const FREE_DAILY_LIMIT = 30;

const ENDPOINT_LABELS: Record<string, string> = {
  tutor: "Tony Starrk (tutor)",
  wellbeing: "Sherlock (wellbeing)",
  "study-plan": "Study plans",
  match: "Personality match",
  "extract-memory": "Memory extraction",
  "analyze-session": "Session analysis",
};

export function UsageSection() {
  const { user } = useSupabaseSession();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.id) return;
      setLoading(true);
      setErr("");
      try {
        // 30-day window covers today/week/month at once. Cap at 5000
        // for safety even though typical users have hundreds.
        const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("ai_usage")
          .select("endpoint, created_at")
          .eq("user_id", user.id)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (cancelled) return;
        if (error) { setErr(error.message); setLoading(false); return; }

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const todayCutoff = new Date(); todayCutoff.setHours(0, 0, 0, 0);
        const todayCutoffMs = todayCutoff.getTime();

        let today = 0, week = 0, month = 0;
        const byEndpoint: Record<string, number> = {};
        for (const row of (data ?? []) as UsageRow[]) {
          const t = new Date(row.created_at).getTime();
          if (t >= todayCutoffMs) today++;
          if (now - t <= 7 * dayMs) week++;
          if (now - t <= 30 * dayMs) month++;
          byEndpoint[row.endpoint] = (byEndpoint[row.endpoint] || 0) + 1;
        }
        setStats({ today, week, month, total: data?.length ?? 0, byEndpoint });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load usage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="grid place-items-center py-12 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (err) {
    return <Note tone="warn">Couldn't load usage: {err}</Note>;
  }

  const s = stats!;
  const todayPct = Math.min(100, Math.round((s.today / FREE_DAILY_LIMIT) * 100));

  return (
    <>
      <Group title="Today" hint="Free plan • resets at midnight">
        <div className="px-4 py-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-semibold text-ink-1">{s.today}</span>
            <span className="text-sm text-ink-3">/ {FREE_DAILY_LIMIT} messages</span>
          </div>
          <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={`h-full transition-all ${todayPct >= 90 ? "bg-red-500" : todayPct >= 70 ? "bg-amber-500" : "bg-accent"}`}
              style={{ width: `${todayPct}%` }}
            />
          </div>
          <div className="text-xs text-ink-3 mt-1.5">
            {s.today >= FREE_DAILY_LIMIT
              ? "Daily limit reached. Upgrade to Student Pro for unlimited."
              : `${FREE_DAILY_LIMIT - s.today} left today`}
          </div>
        </div>
      </Group>

      <Group title="Activity">
        <div className="grid grid-cols-3 divide-x divide-line/40">
          <Stat label="This week" value={s.week} icon={Calendar} />
          <Stat label="This month" value={s.month} icon={BarChart3} />
          <Stat label="All-time (30d)" value={s.total} icon={MessageSquare} />
        </div>
      </Group>

      {Object.keys(s.byEndpoint).length > 0 && (
        <Group title="Breakdown by feature">
          {Object.entries(s.byEndpoint)
            .sort((a, b) => b[1] - a[1])
            .map(([endpoint, count]) => {
              const label = ENDPOINT_LABELS[endpoint] || endpoint;
              const pct = Math.round((count / s.month) * 100) || 0;
              return (
                <div key={endpoint} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink-1 truncate">{label}</div>
                    <div className="h-1.5 mt-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full bg-accent/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-sm text-ink-1 font-medium tabular-nums">{count}</div>
                </div>
              );
            })}
        </Group>
      )}

      <Note>
        Usage counts are shared with basudrus.com — calls from either site count toward the same daily limit.
      </Note>
    </>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof BarChart3 }) {
  return (
    <div className="px-4 py-4 text-center">
      <Icon className="h-4 w-4 text-ink-3 mx-auto mb-1.5" />
      <div className="text-2xl font-semibold text-ink-1 tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-3 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
