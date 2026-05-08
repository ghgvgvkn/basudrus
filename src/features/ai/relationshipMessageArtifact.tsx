/**
 * RelationshipMessageArtifact — premium card for messages Noor
 * helped the student draft to someone in their life. NOT real-time
 * mediation — student copies and sends themselves.
 *
 * Visual treatment differs from professor email artifact:
 *   • Channel-aware header (WhatsApp green, Instagram pink, etc.).
 *   • messageType tag — "Goodbye" / "Setting a boundary" /
 *     "Family conversation" — so the student knows the kind of
 *     thing they're holding before they read it.
 *   • Risk note is rendered IN THE CARD (above body), prominent,
 *     when present. Not buried below.
 *   • "Sleep on it" indicator when suggestSleepOnIt is true — soft
 *     reminder this is a heavy draft worth waiting on.
 *   • Single Copy button (no "send via" — we never auto-route to a
 *     specific phone number; safer for the student to paste into
 *     their own app).
 *   • Coaching note below the card, same as professor email.
 */
import { useState } from "react";
import type { RelationshipMessageArtifact as T } from "@/shared/types";
import { Copy, Check, MessageCircle, Mail, Users, AlertTriangle, Moon } from "lucide-react";

interface Props {
  artifact: T;
}

export function RelationshipMessageArtifact({ artifact }: Props) {
  const [copied, setCopied] = useState(false);
  const isAr = artifact.lang === "ar";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = artifact.body;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn("[relationshipMessageArtifact] copy failed:", err);
      }
    }
  };

  // Channel styling — pick a soft accent that fits the platform's
  // recognizable color (WhatsApp green, Instagram magenta, iMessage
  // blue) without being cartoonish. "in_person" = warm gray,
  // "email" = neutral blue, "other" = neutral.
  const channelStyle = (() => {
    switch (artifact.channel) {
      case "whatsapp":     return { color: "#25D366", icon: <MessageCircle size={13} />, label: "WhatsApp" };
      case "imessage":     return { color: "#0A84FF", icon: <MessageCircle size={13} />, label: "iMessage / Text" };
      case "instagram_dm": return { color: "#C13584", icon: <MessageCircle size={13} />, label: "Instagram DM" };
      case "in_person":    return { color: "#A0814E", icon: <Users size={13} />,         label: isAr ? "حديث وجهاً لوجه" : "In-person conversation" };
      case "email":        return { color: "#5B4BF5", icon: <Mail size={13} />,           label: "Email" };
      default:             return { color: "#6B6B7A", icon: <MessageCircle size={13} />, label: isAr ? "رسالة" : "Message" };
    }
  })();

  // Message-type tag — the "what kind of thing this is" label.
  const typeLabel = (() => {
    const map = isAr ? {
      general: "رسالة",
      boundary_setting: "وضع حدود",
      goodbye: "وداع",
      family_conversation: "حديث عائلي",
      apology: "اعتذار",
      checkin: "اطمئنان",
    } : {
      general: "Message",
      boundary_setting: "Setting a boundary",
      goodbye: "Goodbye",
      family_conversation: "Family conversation",
      apology: "Apology",
      checkin: "Check-in",
    };
    return map[artifact.messageType];
  })();

  // Tone tag.
  const toneLabel = (() => {
    const map = isAr ? {
      warm: "ودي",
      direct: "مباشر",
      firm: "حازم",
      compassionate: "رحيم",
    } : {
      warm: "Warm",
      direct: "Direct",
      firm: "Firm",
      compassionate: "Compassionate",
    };
    return map[artifact.tone];
  })();

  // Body presentation — for in_person, label as "talking points"
  // because it's an outline, not a single message.
  const bodyHeader = artifact.channel === "in_person"
    ? (isAr ? "نقاط للحديث" : "Talking points")
    : (isAr ? "الرسالة" : "Message");

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-ink/10 bg-bg shadow-sm">
      {/* Header strip — channel icon + type tag + tone tag */}
      <div className="flex items-center gap-2 px-4 md:px-5 py-3 border-b border-ink/8 bg-ink/[2%]">
        <span style={{ color: channelStyle.color }} className="inline-flex items-center gap-1.5">
          {channelStyle.icon}
          <span className="text-[12.5px] font-semibold">{channelStyle.label}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span
            className="text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold"
            style={{ background: `${channelStyle.color}15`, color: channelStyle.color }}
          >
            {typeLabel}
          </span>
          <span className="text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-ink/8 text-ink/60 font-medium">
            {toneLabel}
          </span>
        </span>
      </div>

      <div className="px-4 md:px-5 py-4" dir={isAr ? "rtl" : "ltr"}>
        {/* Recipient row */}
        <div className="text-[12px] text-ink/55 inline-flex items-center gap-2">
          <span className="font-medium uppercase tracking-wider">{isAr ? "إلى:" : "To:"}</span>
          <span className="text-ink/85 font-medium">{artifact.recipient}</span>
        </div>

        {/* Risk note — when present, rendered prominently above the
            body so the student sees the warning before they read.
            Used for high-stakes drafts (goodbye, boundary). */}
        {artifact.riskNote && (
          <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200/60 px-3 py-2.5 text-[12.5px] text-rose-900 leading-relaxed flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rose-700" />
            <span><span className="font-semibold">{isAr ? "ملاحظة:" : "Heads up:"}</span> {artifact.riskNote}</span>
          </div>
        )}

        {/* Sleep-on-it nudge — separate from risk, softer. */}
        {artifact.suggestSleepOnIt && (
          <div className="mt-2 rounded-xl bg-indigo-50 border border-indigo-200/60 px-3 py-2 text-[12px] text-indigo-900 leading-snug inline-flex items-start gap-2">
            <Moon size={13} className="shrink-0 mt-0.5 text-indigo-700" />
            <span>{isAr ? "اقترح أن تنام على هذا. إذا حسسته صحيحاً صباحاً، هو صحيح." : "Sleep on this one. If it still feels right tomorrow morning, it is."}</span>
          </div>
        )}

        {/* Body label */}
        <div className="mt-3 text-[12px] text-ink/55 font-medium uppercase tracking-wider">
          {bodyHeader}
        </div>

        {/* Body — pre-wrap, monospace-readable for in-person outlines,
            normal sans for messages. */}
        <div
          className={
            "mt-1.5 text-[14px] text-ink/90 whitespace-pre-wrap leading-relaxed " +
            (artifact.channel === "in_person" ? "font-medium" : "")
          }
        >
          {artifact.body}
        </div>
      </div>

      {/* Action footer — only Copy. Deliberately NO "send" button.
          Student opens their own app to send so we never auto-route
          to a wrong recipient and they retain full control. */}
      <div className="px-4 md:px-5 py-3 border-t border-ink/8 flex flex-wrap items-center gap-2 bg-ink/[2%]">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-ink text-bg text-[12.5px] font-medium hover:bg-ink/85 transition active:scale-95"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied
            ? (isAr ? "تم النسخ" : "Copied")
            : (isAr ? "نسخ الرسالة" : "Copy message")}
        </button>
        <span className="text-[11px] text-ink/45">
          {isAr ? "افتح تطبيقك واللصق هناك" : "Open your app and paste"}
        </span>
      </div>

      {/* Coaching note — Noor's "when to send / what to expect" lives
          OUTSIDE the message body so it doesn't get copied. */}
      {artifact.coachingNote && (
        <div className="px-4 md:px-5 py-3 border-t border-ink/6 bg-ink/[1.5%]">
          <div className="text-[10.5px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
            {isAr ? "ملاحظة من نور" : "Note from Noor"}
          </div>
          <p className="text-[13px] text-ink/70 leading-relaxed whitespace-pre-wrap">
            {artifact.coachingNote}
          </p>
        </div>
      )}
    </div>
  );
}
