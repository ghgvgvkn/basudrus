/**
 * CvArtifact — premium card showing a structured CV the student can
 * review, copy into Word / Google Docs / LinkedIn, or download as a
 * PNG image.
 *
 * Two layouts in this file:
 *   • The on-screen CARD (this component) — interactive, has buttons,
 *     coaching notes from Tony Starrk, the TOC chip strip.
 *   • The PRINT LAYOUT (cvPrintLayout.tsx) — A4-aspect, no buttons,
 *     no coaching notes, used as the html2canvas render target for
 *     PNG export. Off-screen, mounted on demand.
 *
 * Three actions on the card:
 *   1. Download PNG  — html2canvas → PNG → triggers download.
 *   2. Copy as plain text — clean text version for Word/LinkedIn.
 *   3. Email me this — uses the same backend email pipeline as plans.
 */
import { useRef, useState } from "react";
import type { CvArtifact as T } from "@/shared/types";
import { Copy, Check, FileText, Linkedin, Github, Globe, Mail, Phone, MapPin, Download, Loader2 } from "lucide-react";
import { cvToPlainText } from "./parseCv";
import { CvPrintLayout } from "./cvPrintLayout";

interface Props {
  artifact: T;
}

// Stable per-render ID so the print layout DOM node is findable by
// html2canvas without colliding with other CVs in the same chat.
let cvCounter = 0;
function nextCvId(): string {
  cvCounter += 1;
  return `bu-cv-print-${cvCounter}-${Date.now().toString(36)}`;
}

export function CvArtifact({ artifact }: Props) {
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [pdfState, setPdfState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [showPrintLayout, setShowPrintLayout] = useState(false);
  const printIdRef = useRef<string>(nextCvId());
  const isAr = artifact.lang === "ar";

  /** Generate and download a PNG of the CV.
   *
   *  Flow:
   *    1. Mount the off-screen <CvPrintLayout> (sets state).
   *    2. requestAnimationFrame to ensure the DOM is paint-stable.
   *    3. Lazy-import html2canvas-pro (~50KB) — only ships when a
   *       student actually downloads, never bloats the initial bundle.
   *    4. Capture the print node at 2x scale for crisp output.
   *    5. Convert canvas → PNG data URL → download.
   *    6. Unmount the print layout. */
  const handleDownloadPng = async () => {
    if (downloadState === "rendering") return;
    setDownloadState("rendering");
    setShowPrintLayout(true);
    try {
      // Two RAFs to guarantee the print node is fully laid out and
      // painted before html2canvas reads it. One RAF for React commit,
      // a second for the browser paint pass. Important on Safari.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const node = document.getElementById(printIdRef.current);
      if (!node) {
        setDownloadState("error");
        setShowPrintLayout(false);
        return;
      }
      // Lazy import — bundle stays slim until a student actually
      // hits this button.
      const mod = await import("html2canvas-pro");
      const html2canvas = (mod as { default: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement> }).default;
      const canvas = await html2canvas(node, {
        scale: 2,                  // 2x for crisp output on retina
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      // Trigger download.
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(artifact.personal.fullName || "cv").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-cv.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (e) {
      console.warn("[cvArtifact] PNG download failed:", e);
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 3000);
    } finally {
      // Always unmount the print layout — keeping it in the DOM
      // wastes memory if the student never re-downloads.
      setShowPrintLayout(false);
    }
  };

  /** Generate and download a PDF of the CV.
   *
   *  Same off-screen capture pipeline as PNG, but the canvas is
   *  embedded into a jsPDF document at A4 dimensions. PDF is the
   *  industry-standard format employers expect for CV submissions,
   *  so this is the recommended download path.
   *
   *  Both libraries (html2canvas-pro + jspdf) are lazy-loaded —
   *  initial bundle stays slim until a student actually downloads. */
  const handleDownloadPdf = async () => {
    if (pdfState === "rendering") return;
    setPdfState("rendering");
    setShowPrintLayout(true);
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const node = document.getElementById(printIdRef.current);
      if (!node) {
        setPdfState("error");
        setShowPrintLayout(false);
        return;
      }
      // Lazy-load BOTH libraries. They land as separate chunks so
      // the first one (html2canvas) caches cleanly even if a student
      // only downloads PDFs.
      const [h2cMod, jsPdfMod] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const html2canvas = (h2cMod as { default: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement> }).default;
      const { jsPDF } = jsPdfMod as unknown as { jsPDF: new (opts?: Record<string, unknown>) => {
        addImage: (data: string, fmt: string, x: number, y: number, w: number, h: number) => void;
        save: (filename: string) => void;
        internal: { pageSize: { getWidth(): number; getHeight(): number } };
      }};
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      // A4 portrait — 210mm × 297mm. We embed the captured image at
      // page width and let height follow proportionally. If the CV is
      // taller than one page, jsPDF will silently clip — but our
      // print layout is sized for ~one A4 page so we're typically OK.
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      // Compute height from the canvas aspect to keep proportions.
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      // Embed at top-left. If imgHeight exceeds A4, cap to page —
      // the small margin loss is preferable to a multi-page split
      // mid-document for v1.
      const renderHeight = Math.min(imgHeight, pageHeight);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92); // jpeg keeps PDF size sane
      pdf.addImage(dataUrl, "JPEG", 0, 0, imgWidth, renderHeight);
      const filename = `${(artifact.personal.fullName || "cv").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-cv.pdf`;
      pdf.save(filename);
      setPdfState("done");
      setTimeout(() => setPdfState("idle"), 2500);
    } catch (e) {
      console.warn("[cvArtifact] PDF download failed:", e);
      setPdfState("error");
      setTimeout(() => setPdfState("idle"), 3000);
    } finally {
      setShowPrintLayout(false);
    }
  };

  const handleCopy = async () => {
    const text = cvToPlainText(artifact);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn("[cvArtifact] copy failed:", err);
      }
    }
  };

  const modeLabel = (() => {
    const map = isAr ? {
      jordanian: "للسوق الأردني",
      western: "للسوق الغربي",
      ats_friendly: "متوافق مع أنظمة التوظيف",
    } : {
      jordanian: "Jordanian market",
      western: "Western market",
      ats_friendly: "ATS-friendly",
    };
    return map[artifact.renderMode];
  })();

  const sections: Array<{ key: string; label: string; show: boolean }> = [
    { key: "summary", label: isAr ? "نبذة" : "Summary", show: !!artifact.summary },
    { key: "education", label: isAr ? "التعليم" : "Education", show: artifact.education.length > 0 },
    { key: "experience", label: isAr ? "الخبرة" : "Experience", show: artifact.experience.length > 0 },
    { key: "projects", label: isAr ? "المشاريع" : "Projects", show: artifact.projects.length > 0 },
    { key: "skills", label: isAr ? "المهارات" : "Skills", show:
        !!(artifact.skills.technical?.length || artifact.skills.languages?.length || artifact.skills.tools?.length || artifact.skills.soft?.length) },
    { key: "activities", label: isAr ? "النشاطات" : "Activities", show: !!(artifact.activities?.length) },
    { key: "certifications", label: isAr ? "الشهادات" : "Certifications", show: !!(artifact.certifications?.length) },
  ];

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-ink/10 bg-bg shadow-sm" dir={isAr ? "rtl" : "ltr"}>
      {/* Top strip — meta */}
      <div className="flex items-center gap-2 px-4 md:px-5 py-3 border-b border-ink/8 bg-ink/[2%]">
        <FileText size={14} className="text-[#5B4BF5]" />
        <span className="text-[12.5px] font-semibold text-ink">
          {isAr ? "السيرة الذاتية" : "CV / Résumé"}
        </span>
        <span
          className="ml-auto text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "#5B4BF515", color: "#5B4BF5" }}
        >
          {modeLabel}
        </span>
      </div>

      {/* Personal header */}
      <div className="px-5 md:px-6 pt-5 pb-3 border-b border-ink/6">
        <h2 className="font-serif italic text-2xl md:text-3xl text-ink leading-tight">
          {artifact.personal.fullName}
        </h2>
        {artifact.personal.title && (
          <div className="mt-1 text-[13.5px] text-ink/65">{artifact.personal.title}</div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink/60">
          {artifact.personal.email && <ContactBit icon={<Mail size={11} />} value={artifact.personal.email} />}
          {artifact.personal.phone && <ContactBit icon={<Phone size={11} />} value={artifact.personal.phone} />}
          {artifact.personal.location && <ContactBit icon={<MapPin size={11} />} value={artifact.personal.location} />}
          {artifact.personal.linkedin && <ContactBit icon={<Linkedin size={11} />} value={shortUrl(artifact.personal.linkedin)} />}
          {artifact.personal.github && <ContactBit icon={<Github size={11} />} value={shortUrl(artifact.personal.github)} />}
          {artifact.personal.portfolio && <ContactBit icon={<Globe size={11} />} value={shortUrl(artifact.personal.portfolio)} />}
        </div>
      </div>

      {/* Quick TOC strip — small chips of which sections are filled */}
      <div className="px-5 md:px-6 py-2.5 border-b border-ink/6 bg-ink/[1.5%] flex flex-wrap gap-1.5">
        {sections.filter((s) => s.show).map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center h-6 px-2.5 rounded-full text-[10.5px] uppercase tracking-wider font-semibold bg-ink/5 text-ink/55"
          >
            {s.label}
          </span>
        ))}
      </div>

      {/* Body — sections */}
      <div className="px-5 md:px-6 py-5 space-y-5">
        {artifact.summary && (
          <Section label={isAr ? "نبذة" : "SUMMARY"}>
            <p className="text-[13.5px] text-ink/80 leading-relaxed">{artifact.summary}</p>
          </Section>
        )}

        {artifact.education.length > 0 && (
          <Section label={isAr ? "التعليم" : "EDUCATION"}>
            <div className="space-y-3">
              {artifact.education.map((e, i) => (
                <div key={`edu-${i}`}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="font-semibold text-ink text-[14px]">{e.institution}</div>
                    <div className="text-[11.5px] text-ink/55 tabular-nums">
                      {[e.startDate, e.endDate].filter(Boolean).join(" – ")}
                    </div>
                  </div>
                  <div className="text-[12.5px] text-ink/70 mt-0.5">
                    {e.degree}
                    {e.gpa && <span className="text-ink/55"> · GPA {e.gpa}</span>}
                    {e.location && <span className="text-ink/55"> · {e.location}</span>}
                  </div>
                  {(e.relevantCoursework ?? []).length > 0 && (
                    <div className="mt-1 text-[12px] text-ink/65">
                      <span className="font-medium">{isAr ? "مساقات ذات صلة:" : "Relevant coursework:"} </span>
                      {e.relevantCoursework!.join(", ")}
                    </div>
                  )}
                  {(e.honors ?? []).length > 0 && (
                    <ul className="mt-1 ps-4 list-disc text-[12.5px] text-ink/70 space-y-0.5">
                      {e.honors!.map((h, j) => <li key={j}>{h}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {artifact.experience.length > 0 && (
          <Section label={isAr ? "الخبرة" : "EXPERIENCE"}>
            <div className="space-y-3">
              {artifact.experience.map((x, i) => (
                <div key={`exp-${i}`}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="font-semibold text-ink text-[14px]">{x.title}</div>
                    <div className="text-[11.5px] text-ink/55 tabular-nums">
                      {[x.startDate, x.endDate].filter(Boolean).join(" – ")}
                    </div>
                  </div>
                  <div className="text-[12.5px] text-ink/70 mt-0.5">
                    {x.organization}{x.location && <span className="text-ink/55"> · {x.location}</span>}
                  </div>
                  <ul className="mt-1.5 ps-4 list-disc text-[13px] text-ink/80 space-y-1">
                    {x.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {artifact.projects.length > 0 && (
          <Section label={isAr ? "المشاريع" : "PROJECTS"}>
            <div className="space-y-3">
              {artifact.projects.map((p, i) => (
                <div key={`proj-${i}`}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="font-semibold text-ink text-[14px]">{p.name}</div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11.5px] text-[#5B4BF5] hover:underline truncate max-w-[180px]"
                      >
                        {shortUrl(p.url)}
                      </a>
                    )}
                  </div>
                  {p.role && <div className="text-[12.5px] text-ink/65 mt-0.5">{p.role}</div>}
                  {(p.techStack ?? []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.techStack!.map((t, j) => (
                        <span
                          key={j}
                          className="text-[10.5px] px-1.5 py-0.5 rounded bg-[#5B4BF5]/10 text-[#5B4BF5] font-medium"
                        >{t}</span>
                      ))}
                    </div>
                  )}
                  <ul className="mt-1.5 ps-4 list-disc text-[13px] text-ink/80 space-y-1">
                    {p.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(artifact.skills.technical?.length || artifact.skills.languages?.length || artifact.skills.tools?.length || artifact.skills.soft?.length) ? (
          <Section label={isAr ? "المهارات" : "SKILLS"}>
            <div className="space-y-1.5 text-[13px] text-ink/80">
              {(artifact.skills.technical?.length || 0) > 0 && (
                <SkillRow label={isAr ? "تقنية" : "Technical"} items={artifact.skills.technical!} />
              )}
              {(artifact.skills.tools?.length || 0) > 0 && (
                <SkillRow label={isAr ? "أدوات" : "Tools"} items={artifact.skills.tools!} />
              )}
              {(artifact.skills.languages?.length || 0) > 0 && (
                <SkillRow
                  label={isAr ? "اللغات" : "Languages"}
                  items={artifact.skills.languages!.map((l) => `${l.name} (${l.level})`)}
                />
              )}
              {(artifact.skills.soft?.length || 0) > 0 && (
                <SkillRow label={isAr ? "مهارات عامة" : "Soft skills"} items={artifact.skills.soft!} />
              )}
            </div>
          </Section>
        ) : null}

        {artifact.activities && artifact.activities.length > 0 && (
          <Section label={isAr ? "النشاطات" : "ACTIVITIES"}>
            <div className="space-y-3">
              {artifact.activities.map((a, i) => (
                <div key={`act-${i}`}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="font-semibold text-ink text-[14px]">{a.role}</div>
                    <div className="text-[11.5px] text-ink/55 tabular-nums">
                      {[a.startDate, a.endDate].filter(Boolean).join(" – ")}
                    </div>
                  </div>
                  <div className="text-[12.5px] text-ink/70 mt-0.5">{a.organization}</div>
                  {(a.bullets ?? []).length > 0 && (
                    <ul className="mt-1 ps-4 list-disc text-[12.5px] text-ink/80 space-y-0.5">
                      {a.bullets!.map((b, j) => <li key={j}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {artifact.certifications && artifact.certifications.length > 0 && (
          <Section label={isAr ? "الشهادات" : "CERTIFICATIONS"}>
            <ul className="space-y-1 text-[12.5px] text-ink/80">
              {artifact.certifications.map((c, i) => (
                <li key={`cert-${i}`}>
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.issuer && <span className="text-ink/65"> · {c.issuer}</span>}
                  {c.date && <span className="text-ink/55"> · {c.date}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Action footer — three actions, PDF first (industry standard
          for CV submissions), then PNG (good for messaging / mobile),
          then plain text (for further editing in Word / Docs / LinkedIn). */}
      <div className="px-4 md:px-5 py-3 border-t border-ink/8 flex flex-wrap items-center gap-2 bg-ink/[2%]">
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfState === "rendering" || downloadState === "rendering"}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-ink text-bg text-[12.5px] font-medium hover:bg-ink/85 transition active:scale-95 disabled:opacity-60 disabled:cursor-default"
        >
          {pdfState === "rendering" && <Loader2 size={13} className="animate-spin" />}
          {pdfState === "idle" && <Download size={13} />}
          {pdfState === "done" && <Check size={13} />}
          {pdfState === "error" && <Download size={13} />}
          {pdfState === "idle" && (isAr ? "تنزيل PDF" : "Download PDF")}
          {pdfState === "rendering" && (isAr ? "جاري التحضير…" : "Preparing…")}
          {pdfState === "done" && (isAr ? "تم التنزيل" : "Downloaded")}
          {pdfState === "error" && (isAr ? "حاول مجدداً" : "Try again")}
        </button>
        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={downloadState === "rendering" || pdfState === "rendering"}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ink/15 text-ink/80 hover:bg-ink/5 hover:text-ink text-[12.5px] font-medium transition active:scale-95 disabled:opacity-60 disabled:cursor-default"
        >
          {downloadState === "rendering" && <Loader2 size={13} className="animate-spin" />}
          {downloadState === "idle" && <Download size={13} />}
          {downloadState === "done" && <Check size={13} />}
          {downloadState === "error" && <Download size={13} />}
          {downloadState === "idle" && (isAr ? "PNG" : "PNG")}
          {downloadState === "rendering" && (isAr ? "جاري…" : "…")}
          {downloadState === "done" && (isAr ? "تم" : "Done")}
          {downloadState === "error" && (isAr ? "حاول مجدداً" : "Retry")}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ink/15 text-ink/80 hover:bg-ink/5 hover:text-ink text-[12.5px] font-medium transition active:scale-95"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied
            ? (isAr ? "تم النسخ" : "Copied")
            : (isAr ? "نسخ كنص" : "Copy text")}
        </button>
        <span className="text-[11px] text-ink/45 whitespace-nowrap ms-auto">
          {isAr ? "PDF للمواقع · PNG للمحادثات" : "PDF for jobs · PNG for chat"}
        </span>
      </div>

      {/* Off-screen print layout — mounted only during the download
          flow. Position fixed at -99999px keeps it invisible while
          html2canvas can still capture it. */}
      {showPrintLayout && (
        <CvPrintLayout artifact={artifact} id={printIdRef.current} />
      )}

      {/* Coaching note from Tony Starrk */}
      {artifact.coachingNote && (
        <div className="px-4 md:px-5 py-3 border-t border-ink/6 bg-ink/[1.5%]">
          <div className="text-[10.5px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
            {isAr ? "ملاحظة من عمر" : "Note from Tony Starrk"}
          </div>
          <p className="text-[13px] text-ink/70 leading-relaxed whitespace-pre-wrap">
            {artifact.coachingNote}
          </p>
        </div>
      )}
    </div>
  );
}

function ContactBit({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink/65">
      {icon}
      <span>{value}</span>
    </span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10.5px] uppercase tracking-[0.16em] text-ink/45 font-bold mb-2 border-b border-ink/8 pb-1">
        {label}
      </h3>
      {children}
    </section>
  );
}

function SkillRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <span className="font-semibold text-ink/85">{label}: </span>
      <span className="text-ink/70">{items.join(", ")}</span>
    </div>
  );
}

/** Strip protocol + www. for compactness in the contact strip and
 *  project link lists. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}
