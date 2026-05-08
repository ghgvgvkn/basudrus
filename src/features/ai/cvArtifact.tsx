/**
 * CvArtifact — premium card showing a structured CV the student can
 * review and copy into Word / Google Docs / LinkedIn.
 *
 * Layout: serif header with the student's name + title, then
 * sections in the order most useful for entry-level Jordanian
 * applicants (education first, then projects for STEM, then
 * experience, skills, activities, certifications).
 *
 * Single primary action: "Copy as plain text" — pastes a clean
 * structured CV the student can format further in their editor.
 * No "send" / no "PDF export" yet (PDF export adds a heavy
 * dependency; can ship later).
 */
import { useState } from "react";
import type { CvArtifact as T } from "@/shared/types";
import { Copy, Check, FileText, Linkedin, Github, Globe, Mail, Phone, MapPin } from "lucide-react";
import { cvToPlainText } from "./parseCv";

interface Props {
  artifact: T;
}

export function CvArtifact({ artifact }: Props) {
  const [copied, setCopied] = useState(false);
  const isAr = artifact.lang === "ar";

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

      {/* Action footer */}
      <div className="px-4 md:px-5 py-3 border-t border-ink/8 flex flex-wrap items-center gap-2 bg-ink/[2%]">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-ink text-bg text-[12.5px] font-medium hover:bg-ink/85 transition active:scale-95"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied
            ? (isAr ? "تم النسخ" : "Copied")
            : (isAr ? "نسخ كنص" : "Copy as plain text")}
        </button>
        <span className="text-[11px] text-ink/45">
          {isAr ? "الصق في Word / Google Docs / LinkedIn" : "Paste into Word / Google Docs / LinkedIn"}
        </span>
      </div>

      {/* Coaching note from Omar */}
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
