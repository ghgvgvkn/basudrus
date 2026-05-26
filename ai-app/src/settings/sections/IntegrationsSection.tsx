/**
 * IntegrationsSection — connect external tool providers (Zapier).
 *
 * Per-user Zapier MCP wiring. The user creates a Zapier MCP server
 * URL at https://mcp.zapier.com/mcp/servers/new (which authorizes
 * their integrations: Gmail, Calendar, Slack, etc.), pastes that
 * URL here, and Aurora stores it in user_integrations scoped to
 * their account. After that, aurora.ts will fetch their URL on
 * every chat turn and pass it into Anthropic's mcp_servers field —
 * Tony can then call THEIR Zapier actions on their behalf.
 *
 * WHY PASTE-URL INSTEAD OF OAUTH (v1 decision)
 *
 *   Building a Zapier OAuth integration requires registering a
 *   Zapier developer app + redirect handlers + token storage. That's
 *   3-5 sessions of work on its own. The paste-URL approach gets us
 *   to "client gets value" in a single session — they spend 2 min on
 *   Zapier's setup flow and then paste one string here. We can swap
 *   in OAuth later without changing the storage shape.
 *
 * SECURITY MODEL
 *
 *   The Zapier MCP URL is a bearer credential — anyone with the URL
 *   can use the user's connected integrations. So:
 *     - URL is stored in user_integrations with strict per-user RLS
 *       (defined in 20260526_user_integrations.sql)
 *     - We never log the URL, even in error messages
 *     - We never render the full URL after save — only "Connected"
 *       status + a Disconnect button. To rotate, the user pastes
 *       a new URL (UPSERT, single row per user/provider).
 *     - The input is type="password" so it doesn't leak on screen
 *       shares / screenshots / autofill history.
 *
 * VALIDATION
 *
 *   Light: must be HTTPS + look roughly like a Zapier MCP URL. We
 *   don't actually probe the URL — that requires server-side
 *   network access which we can't trigger from a settings page. A
 *   bad URL will silently no-op at chat time (aurora.ts handles
 *   that gracefully). Adding a "Test connection" button is on the
 *   roadmap once we have a dedicated /api/integrations/test
 *   endpoint.
 */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plug, Trash2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Group, Note, PrimaryButton, GhostButton, Tag } from "./parts";

interface ZapierIntegrationRow {
  id: string;
  endpoint_url: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export function IntegrationsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<ZapierIntegrationRow | null>(null);

  // Form state for connecting / re-connecting.
  const [urlInput, setUrlInput] = useState("");
  const [labelInput, setLabelInput] = useState("");

  // Fetch existing row on mount + after any save. Best-effort —
  // RLS means we can only see our own row anyway.
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("user_integrations")
        .select("id, endpoint_url, label, created_at, updated_at")
        .eq("provider", "zapier")
        .maybeSingle();
      if (err) throw err;
      setRow((data as ZapierIntegrationRow | null) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Quick shape validation — must be an https URL pointing at Zapier's
  // MCP host. Light intentionally: we don't want to false-reject if
  // Zapier ever changes the path shape. The real validation happens
  // at chat time (a bad URL = no tools surfaced, gracefully).
  function validateZapierUrl(raw: string): string | null {
    const url = raw.trim();
    if (!url) return "Paste your Zapier MCP server URL first.";
    if (!url.startsWith("https://")) return "URL must start with https://";
    if (!url.includes("zapier.com")) {
      return "That doesn't look like a Zapier MCP URL — get one at mcp.zapier.com/mcp/servers/new";
    }
    if (url.length < 30) return "URL looks too short — make sure you copied the whole thing.";
    return null;
  }

  const handleConnect = async () => {
    const validationError = validateZapierUrl(urlInput);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Need the user's ID to satisfy the RLS insert policy
      // (auth.uid() = user_id). Supabase JS client will also add the
      // auth header automatically, but we must include user_id
      // explicitly in the row payload.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in first — settings won't save without a session.");
        return;
      }
      // UPSERT on (user_id, provider) so re-connecting (after URL
      // rotation) updates in place instead of erroring on the unique
      // constraint.
      const { error: err } = await supabase
        .from("user_integrations")
        .upsert(
          {
            user_id: user.id,
            provider: "zapier",
            endpoint_url: urlInput.trim(),
            label: labelInput.trim() || null,
          },
          { onConflict: "user_id,provider" },
        );
      if (err) throw err;
      setUrlInput("");
      setLabelInput("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!row) return;
    if (!window.confirm("Disconnect Zapier? Tony won't be able to send emails, check your calendar, or use any other Zapier action until you reconnect.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("user_integrations")
        .delete()
        .eq("id", row.id);
      if (err) throw err;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setSaving(false);
    }
  };

  // Format the created_at date into something readable like
  // "May 26, 2026" so the user sees when they connected this URL.
  const connectedSince = row?.created_at
    ? new Date(row.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <>
      <Group title="Overview">
        <div className="px-4 py-3.5 flex items-start gap-3">
          <Plug className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink-1 font-medium">
              Connect tools so Tony can DO things
            </div>
            <div className="text-xs text-ink-3 mt-1 leading-relaxed">
              Without integrations, Tony can only talk and research.
              Connect Zapier and he can send emails, check your
              calendar, post to Slack, and ~7,000 other actions — all
              under YOUR account, not anyone else's.
            </div>
          </div>
        </div>
      </Group>

      <Group title="Zapier" hint={loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : null}>
        {row ? (
          // ── CONNECTED STATE ──────────────────────────────────────
          <>
            <div className="px-4 py-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Tag tone="success">Connected</Tag>
                {row.label && (
                  <span className="text-xs text-ink-3 truncate">
                    · {row.label}
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-3">
                Linked since {connectedSince}. Tony will use this
                connection when you ask him to send a message, check
                a calendar, or do anything else your Zapier handles.
              </div>
            </div>
            <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <a
                href="https://mcp.zapier.com/mcp/servers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent inline-flex items-center gap-1 hover:underline"
              >
                Manage which actions are exposed
                <ExternalLink className="h-3 w-3" />
              </a>
              <GhostButton tone="danger" onClick={handleDisconnect} disabled={saving}>
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  Disconnect
                </span>
              </GhostButton>
            </div>
          </>
        ) : (
          // ── NOT-CONNECTED STATE ──────────────────────────────────
          <>
            <div className="px-4 py-3.5">
              <ol className="text-xs text-ink-2 space-y-2 leading-relaxed list-decimal list-inside">
                <li>
                  Visit{" "}
                  <a
                    href="https://mcp.zapier.com/mcp/servers/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                  >
                    mcp.zapier.com/mcp/servers/new
                    <ExternalLink className="h-3 w-3 inline" />
                  </a>
                  {" "}— pick <b>Claude</b> when it asks which agent.
                </li>
                <li>Tick the actions you want Tony to do (Gmail send, Calendar create, etc.) and connect each app.</li>
                <li>Copy the server URL Zapier shows you (looks like <code className="text-[10px] bg-surface-2 px-1 rounded">https://mcp.zapier.com/api/mcp/s/&lt;token&gt;/sse</code>).</li>
                <li>Paste it below.</li>
              </ol>
            </div>
            <div className="px-4 py-3.5 space-y-3">
              <div>
                <label className="block text-xs text-ink-3 mb-1.5">
                  Zapier MCP server URL
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://mcp.zapier.com/api/mcp/s/…"
                  className="
                    w-full h-9 px-3 rounded-lg border border-line/60 bg-surface-1
                    text-sm text-ink-1 placeholder:text-ink-3
                    focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/40
                    transition
                  "
                  onKeyDown={(e) => { if (e.key === "Enter") void handleConnect(); }}
                />
                <div className="mt-1.5 text-[11px] text-ink-3 flex items-start gap-1.5">
                  <ShieldCheck className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    Stored encrypted at rest with strict per-user
                    access. Only Tony sees it during your chats —
                    never shared, never logged.
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-ink-3 mb-1.5">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="Personal Gmail, Work account, …"
                  maxLength={80}
                  className="
                    w-full h-9 px-3 rounded-lg border border-line/60 bg-surface-1
                    text-sm text-ink-1 placeholder:text-ink-3
                    focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/40
                    transition
                  "
                />
              </div>
            </div>
            <div className="px-4 py-3">
              <PrimaryButton onClick={handleConnect} disabled={saving || !urlInput.trim()}>
                {saving ? "Connecting…" : "Connect Zapier"}
              </PrimaryButton>
            </div>
          </>
        )}
      </Group>

      {error && <Note tone="warn">{error}</Note>}

      <Group title="More integrations">
        <div className="px-4 py-3.5">
          <div className="text-xs text-ink-3 leading-relaxed">
            More direct integrations (Gmail / Calendar / Slack OAuth
            without Zapier in the middle) are coming. Until then,
            Zapier MCP covers ~7,000 apps and is the fastest way to
            give Tony real action ability.
          </div>
        </div>
      </Group>
    </>
  );
}
