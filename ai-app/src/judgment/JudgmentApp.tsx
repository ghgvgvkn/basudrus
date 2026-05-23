/**
 * JudgmentApp — root for the /judgment/* routes.
 *
 * Simple pathname-based routing (no react-router) — Aurora is a
 * tiny SPA and a 3-screen feature doesn't need a router library.
 *
 * Routes:
 *   /judgment           → Start screen (create new)
 *   /judgment/[code]    → Either:
 *                            (a) join screen (current user isn't a
 *                                participant yet) OR
 *                            (b) chat screen (current user IS a
 *                                participant — A or B)
 *                         Decision made by peeking the judgment row.
 *
 * Navigation is done via window.history.pushState + a custom
 * "navigate" function so the back button works and the URL reflects
 * state for sharing.
 */
import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { JudgmentStartScreen } from "./JudgmentStartScreen";
import { JudgmentJoinScreen } from "./JudgmentJoinScreen";
import { JudgmentChatScreen } from "./JudgmentChatScreen";
import {
  useJudgmentApi,
  peekJudgmentByCode,
  type Judgment,
} from "./useJudgmentApi";
import "./judgment.css";

type View =
  | { kind: "start" }
  | { kind: "join"; code: string }
  | { kind: "chat"; judgment: Judgment }
  | { kind: "loading" }
  | { kind: "error"; message: string };

function viewFromPath(pathname: string): { kind: "start" } | { kind: "code"; code: string } {
  // /judgment        → start
  // /judgment/       → start
  // /judgment/abc123 → code "abc123"
  const m = pathname.match(/^\/judgment\/?([A-Za-z0-9_-]+)?\/?$/);
  if (!m) return { kind: "start" };
  const code = m[1];
  if (!code) return { kind: "start" };
  return { kind: "code", code };
}

export function JudgmentApp({ onBackToAurora }: { onBackToAurora: () => void }) {
  const { user, loading: authLoading } = useSupabaseSession();
  const api = useJudgmentApi();
  const [view, setView] = useState<View>({ kind: "loading" });

  // Resolve the URL → view on mount and on history navigation.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setView({
        kind: "error",
        message: "Sign in on the main Aurora page first, then come back to this link.",
      });
      return;
    }

    const resolve = async () => {
      const parsed = viewFromPath(window.location.pathname);
      if (parsed.kind === "start") {
        setView({ kind: "start" });
        return;
      }
      // Have a code — figure out whether to show join or chat.
      const peek = await peekJudgmentByCode(parsed.code);
      if (!peek.ok) {
        setView({ kind: "error", message: peek.error });
        return;
      }
      if (peek.data.is_party_a) {
        // Current user is Party A — load full judgment and show chat.
        // peekJudgmentByCode returns minimal data; we need the
        // full row for the chat screen. Use list_messages as a
        // poor-man's-fetch (it returns the messages but not the
        // judgment fields). Simpler: assemble a minimal judgment
        // from peek + dummy fields the chat doesn't strictly need.
        setView({
          kind: "chat",
          judgment: {
            id: peek.data.id,
            invite_code: peek.data.invite_code,
            relationship_type: peek.data.relationship_type,
            title: peek.data.title,
            party_a_user_id: user.id, // we know it's us
            party_a_label: peek.data.party_a_label,
            party_b_user_id: null, // filled later if B has joined
            party_b_label: null,
            status: peek.data.status,
            created_at: "",
            updated_at: "",
          },
        });
        return;
      }
      // Not Party A. If status is 'waiting' → show join screen.
      // Otherwise B has already joined OR judgment is past join phase
      // → show chat (RLS will gate access if user isn't a participant).
      if (peek.data.status === "waiting") {
        setView({ kind: "join", code: parsed.code });
      } else {
        // Try to fetch as a participant — if RLS lets them, show chat;
        // otherwise show "not a participant" error.
        const msgs = await api.listMessages({ judgmentId: peek.data.id });
        if (!msgs.ok) {
          setView({
            kind: "error",
            message: "You're not a participant in this judgment, or it's no longer open.",
          });
          return;
        }
        setView({
          kind: "chat",
          judgment: {
            id: peek.data.id,
            invite_code: peek.data.invite_code,
            relationship_type: peek.data.relationship_type,
            title: peek.data.title,
            party_a_user_id: "",
            party_a_label: peek.data.party_a_label,
            party_b_user_id: user.id,
            party_b_label: null,
            status: peek.data.status,
            created_at: "",
            updated_at: "",
          },
        });
      }
    };

    void resolve();

    // Also re-resolve on back/forward navigation.
    const onPop = () => { void resolve(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [authLoading, user, api]);

  const navigate = (to: string) => {
    window.history.pushState(null, "", to);
    // Trigger re-resolution by emitting popstate manually
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  // ── Render based on view state ───────────────────────────────────

  let body: React.ReactNode;
  if (view.kind === "loading") {
    body = <div className="j-body"><div className="j-form-heading">Loading...</div></div>;
  } else if (view.kind === "error") {
    body = (
      <div className="j-body">
        <div className="j-form">
          <div className="j-form-heading">Hmm.</div>
          <div className="j-form-sub">{view.message}</div>
          <button type="button" className="j-btn-secondary" onClick={onBackToAurora}>
            Back to Aurora
          </button>
        </div>
      </div>
    );
  } else if (view.kind === "start") {
    body = (
      <JudgmentStartScreen
        onBack={onBackToAurora}
        onCreated={(j) => {
          // Push URL + render chat
          navigate(`/judgment/${j.invite_code}`);
          setView({ kind: "chat", judgment: j });
        }}
      />
    );
  } else if (view.kind === "join") {
    body = (
      <JudgmentJoinScreen
        inviteCode={view.code}
        onBack={onBackToAurora}
        onJoined={(j) => setView({ kind: "chat", judgment: j })}
        onAlreadyParticipant={(_id) => {
          // We need to set view to chat — but we don't have the full
          // row. peek already gave us enough; re-resolve.
          void (async () => {
            const peek = await peekJudgmentByCode(view.code);
            if (peek.ok && user) {
              setView({
                kind: "chat",
                judgment: {
                  id: peek.data.id,
                  invite_code: peek.data.invite_code,
                  relationship_type: peek.data.relationship_type,
                  title: peek.data.title,
                  party_a_user_id: user.id,
                  party_a_label: peek.data.party_a_label,
                  party_b_user_id: null,
                  party_b_label: null,
                  status: peek.data.status,
                  created_at: "",
                  updated_at: "",
                },
              });
            }
          })();
        }}
      />
    );
  } else if (view.kind === "chat") {
    body = (
      <div className="j-chat-shell">
        <JudgmentChatScreen
          judgment={view.judgment}
          onBack={onBackToAurora}
        />
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div className="judgment-app">
      <div className="j-topbar">
        <button type="button" className="j-back" onClick={onBackToAurora}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Aurora
        </button>
        <div className="j-topbar-title">Judgment</div>
        <div style={{ width: 80 }} />{/* spacer so title centers */}
      </div>
      {body}
    </div>
  );
}
