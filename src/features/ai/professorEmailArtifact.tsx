/**
 * ProfessorEmailArtifact — premium card the student can review,
 * copy verbatim, or open in their mail app.
 *
 * Design: feels like a real email composition window. Subject in a
 * dedicated row, body in a clean readable block, sign-off separated
 * from body, recipient prominently shown. Tone tag in the header
 * tells the student which dial Omar selected so they can ask for a
 * different one. Coaching note (Omar's "why I wrote it this way")
 * lives BELOW the card in subdued text so it doesn't get copied
 * accidentally.
 */
import { useState } from "react";
import type { ProfessorEmailArtifact as T } from "@/shared/types";
import { Mail, Copy, Check, ExternalLink } from "lucide-react";

interface Props {
  artifact: T;
}

export function ProfessorEmailArtifact({ artifact }: Props) {
  const [copied, setCopied] = useState(false);
  const isAr = artifact.lang === "ar";

  // Full email text the student copies — recipient implied by the
  // greeting which the AI puts in the body, so we just join the body
  // and sign-off here. Subject is copied separately when they tap
  // "Copy subject".
  const fullEmailText = `${artifact.body}\n\n${artifact.signOff}`;

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${artifact.subject}\n\n${fullEmailText}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Older browsers / iOS without HTTPS — fallback via textarea.
      try {
        const ta = document.createElement("textarea");
        ta.value = `Subject: ${artifact.subject}\n\n${fullEmailText}`;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn("[professorEmailArtifact] copy failed:", err);
      }
    }
  };

  const handleMailto = () => {
    // Open the user's mail app. We don't pre-fill the recipient
    // address — the AI doesn't know the prof's actual email; the
    // student does. They paste the subject + body into their own
    // compose window.
    const subject = encodeURIComponent(artifact.subject);
    const body = encodeURIComponent(fullEmailText);
    const href = `mailto:?subject=${subject}&body=${body}`;
    window.location.href = href;
  };

  const toneLabel = (() => {
    const map = isAr ? {
      formal: "رسمي",
      respectful_warm: "محترم وودود",
      casual_respectful: "ودي ومحترم",
    } : {
      formal: "Formal",
      respectful_warm: "Respectful & warm",
      casual_respectful: "Casual but respectful",
    };
    return map[artifact.tone];
  })();

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-ink/10 bg-bg shadow-sm">
      {/* Header strip — the meta line above the email itself. */}
      <div className="flex items-center gap-2 px-4 md:px-5 py-3 border-b border-ink/8 bg-ink/[2%]">
        <Mail size={14} className="text-[#5B4BF5]" />
        <span className="text-[12.5px] font-semibold text-ink">
          {isAr ? "بريد للأستاذ" : "Email to professor"}
        </span>
        <span
          className="ml-auto text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: "#5B4BF515", color: "#5B4BF5" }}
        >
          {toneLabel}
        </span>
      </div>

      {/* Email body — looks like a real compose window. dir="auto"
          so the browser flips RTL/LTR per content automatically. */}
      <div className="px-4 md:px-5 py-4" dir={isAr ? "rtl" : "ltr"}>
        {/* "To" row — recipient name only, since the prof's email
            address is something the student already has. */}
        <div className="text-[12px] text-ink/55 inline-flex items-center gap-2">
          <span className="font-medium uppercase tracking-wider">{isAr ? "إلى:" : "To:"}</span>
          <span className="text-ink/85 font-medium">{artifact.recipient}</span>
        </div>

        {/* Subject row */}
        <div className="mt-2 text-[12px] text-ink/55 inline-flex items-start gap-2">
          <span className="font-medium uppercase tracking-wider shrink-0 leading-relaxed">{isAr ? "الموضوع:" : "Subject:"}</span>
          <span className="text-ink/90 font-semibold leading-relaxed">{artifact.subject}</span>
        </div>

        {/* Divider */}
        <div className="my-3 border-t border-ink/6" />

        {/* Body — pre-wrap so newlines render as written. */}
        <div className="text-[14px] text-ink/85 whitespace-pre-wrap leading-relaxed">
          {artifact.body}
        </div>

        {/* Sign-off — visually separated so the student understands
            it's the closing block to keep / customize. */}
        <div className="mt-4 pt-3 border-t border-ink/6 text-[14px] text-ink/85 whitespace-pre-wrap leading-relaxed">
          {artifact.signOff}
        </div>
      </div>

      {/* Action footer */}
      <div className="px-4 md:px-5 py-3 border-t border-ink/8 flex flex-wrap items-center gap-2 bg-ink/[2%]">
        <button
          type="button"
          onClick={handleCopyAll}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-ink text-bg text-[12.5px] font-medium hover:bg-ink/85 transition active:scale-95"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied
            ? (isAr ? "تم النسخ" : "Copied")
            : (isAr ? "نسخ البريد" : "Copy email")}
        </button>
        <button
          type="button"
          onClick={handleMailto}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ink/15 text-ink/80 hover:bg-ink/5 hover:text-ink text-[12.5px] font-medium transition active:scale-95"
        >
          <ExternalLink size={13} />
          {isAr ? "فتح في البريد" : "Open in mail"}
        </button>
      </div>

      {/* Coaching note — Omar's "why I wrote it this way" — lives
          OUTSIDE the email body so it doesn't get copied. Subdued
          styling so the email itself remains the visual focus. */}
      {artifact.coachingNote && (
        <div className="px-4 md:px-5 py-3 border-t border-ink/6 bg-ink/[1.5%]">
          <div className="text-[10.5px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
            {isAr ? "ملاحظة من عمر" : "Note from Omar"}
          </div>
          <p className="text-[13px] text-ink/70 leading-relaxed whitespace-pre-wrap">
            {artifact.coachingNote}
          </p>
        </div>
      )}
    </div>
  );
}
