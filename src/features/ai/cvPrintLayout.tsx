/**
 * CvPrintLayout — A4-aspect, print-optimized version of the CV used
 * EXCLUSIVELY as the html2canvas render target for PNG / PDF export.
 *
 * Visual rules differ from the on-screen card:
 *   • Fixed pixel dimensions (~A4 at 96dpi → 794×1123 px) so the
 *     captured image has predictable proportions.
 *   • Print-friendly typography (serif for name, sans for body,
 *     darker text, no transparent overlays).
 *   • No buttons, no coaching note — those belong to the on-screen
 *     card only. The print version is THE document the student
 *     downloads.
 *   • Subtle left accent bar in the dominant color, makes the page
 *     feel designed not generic.
 *   • Hidden by default (off-screen at -9999px) — only mounted in
 *     the DOM long enough for html2canvas to capture, then unmounts.
 */
import type { CvArtifact } from "@/shared/types";

const PRINT_WIDTH = 794;   // ~A4 width at 96dpi
const PRINT_PADDING = 56;  // generous margin

interface Props {
  artifact: CvArtifact;
  /** Stable ID for html2canvas to find the node. */
  id: string;
}

/** Used by the export flow — render this off-screen, html2canvas it,
 *  unmount. The student only ever sees the resulting PNG. */
export function CvPrintLayout({ artifact, id }: Props) {
  const isAr = artifact.lang === "ar";
  const accent = "#5B4BF5"; // single brand accent for the printed version
  const sk = artifact.skills;

  return (
    <div
      id={id}
      // Off-screen positioning — html2canvas can capture nodes that
      // are positioned absolute/fixed off-screen. Critical that
      // visibility/display aren't 'none' (would prevent capture).
      style={{
        position: "absolute",
        left: "-99999px",
        top: 0,
        width: `${PRINT_WIDTH}px`,
        background: "#ffffff",
        color: "#1A2332",
        fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxSizing: "border-box",
        padding: `${PRINT_PADDING}px`,
        // Subtle left accent bar — a 4px colored stripe down the
        // page. Gives the document a designed feel without being
        // a heavy templated look.
        borderLeft: `4px solid ${accent}`,
      }}
      dir={isAr ? "rtl" : "ltr"}
    >
      {/* Header — name + title + contact strip */}
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 38,
            fontStyle: "italic",
            fontWeight: 400,
            lineHeight: 1.05,
            color: "#0F1116",
          }}
        >
          {artifact.personal.fullName}
        </h1>
        {artifact.personal.title && (
          <div style={{ marginTop: 4, fontSize: 14, color: "#5a6168", letterSpacing: 0.2 }}>
            {artifact.personal.title}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            fontSize: 11.5,
            color: "#5a6168",
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 14px",
          }}
        >
          {artifact.personal.email && <span>{artifact.personal.email}</span>}
          {artifact.personal.phone && <span>{artifact.personal.phone}</span>}
          {artifact.personal.location && <span>{artifact.personal.location}</span>}
          {artifact.personal.linkedin && <span>{shortUrl(artifact.personal.linkedin)}</span>}
          {artifact.personal.github && <span>{shortUrl(artifact.personal.github)}</span>}
          {artifact.personal.portfolio && <span>{shortUrl(artifact.personal.portfolio)}</span>}
        </div>
      </div>

      {/* Summary */}
      {artifact.summary && (
        <PrintSection label={isAr ? "نبذة" : "SUMMARY"} accent={accent}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#3a4250" }}>
            {artifact.summary}
          </p>
        </PrintSection>
      )}

      {/* Education */}
      {artifact.education.length > 0 && (
        <PrintSection label={isAr ? "التعليم" : "EDUCATION"} accent={accent}>
          {artifact.education.map((e, i) => (
            <div key={`pe-${i}`} style={{ marginBottom: 14 }}>
              <RowHead
                left={e.institution}
                right={[e.startDate, e.endDate].filter(Boolean).join(" – ")}
              />
              <div style={{ fontSize: 12.5, color: "#3a4250", marginTop: 2 }}>
                {e.degree}
                {e.gpa && <span style={{ color: "#5a6168" }}> · GPA {e.gpa}</span>}
                {e.location && <span style={{ color: "#5a6168" }}> · {e.location}</span>}
              </div>
              {(e.relevantCoursework ?? []).length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11.5, color: "#5a6168" }}>
                  <span style={{ fontWeight: 600, color: "#3a4250" }}>
                    {isAr ? "مساقات ذات صلة:" : "Relevant coursework:"}{" "}
                  </span>
                  {e.relevantCoursework!.join(", ")}
                </div>
              )}
              {(e.honors ?? []).length > 0 && (
                <ul style={{ marginTop: 4, marginBottom: 0, paddingInlineStart: 18, fontSize: 12, color: "#3a4250" }}>
                  {e.honors!.map((h, j) => <li key={j} style={{ marginBottom: 2 }}>{h}</li>)}
                </ul>
              )}
            </div>
          ))}
        </PrintSection>
      )}

      {/* Experience */}
      {artifact.experience.length > 0 && (
        <PrintSection label={isAr ? "الخبرة" : "EXPERIENCE"} accent={accent}>
          {artifact.experience.map((x, i) => (
            <div key={`px-${i}`} style={{ marginBottom: 14 }}>
              <RowHead
                left={x.title}
                right={[x.startDate, x.endDate].filter(Boolean).join(" – ")}
              />
              <div style={{ fontSize: 12.5, color: "#3a4250", marginTop: 2 }}>
                {x.organization}
                {x.location && <span style={{ color: "#5a6168" }}> · {x.location}</span>}
              </div>
              {x.bullets.length > 0 && (
                <ul style={{ marginTop: 4, marginBottom: 0, paddingInlineStart: 18, fontSize: 12.5, color: "#3a4250", lineHeight: 1.5 }}>
                  {x.bullets.map((b, j) => <li key={j} style={{ marginBottom: 3 }}>{b}</li>)}
                </ul>
              )}
            </div>
          ))}
        </PrintSection>
      )}

      {/* Projects */}
      {artifact.projects.length > 0 && (
        <PrintSection label={isAr ? "المشاريع" : "PROJECTS"} accent={accent}>
          {artifact.projects.map((p, i) => (
            <div key={`pp-${i}`} style={{ marginBottom: 14 }}>
              <RowHead
                left={p.name}
                right={p.url ? shortUrl(p.url) : ""}
              />
              {p.role && (
                <div style={{ fontSize: 12, color: "#5a6168", marginTop: 2 }}>{p.role}</div>
              )}
              {(p.techStack ?? []).length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#3a4250" }}>
                  <span style={{ fontWeight: 600 }}>{isAr ? "التقنيات:" : "Stack:"}</span>{" "}
                  {p.techStack!.join(" · ")}
                </div>
              )}
              {p.bullets.length > 0 && (
                <ul style={{ marginTop: 4, marginBottom: 0, paddingInlineStart: 18, fontSize: 12.5, color: "#3a4250", lineHeight: 1.5 }}>
                  {p.bullets.map((b, j) => <li key={j} style={{ marginBottom: 3 }}>{b}</li>)}
                </ul>
              )}
            </div>
          ))}
        </PrintSection>
      )}

      {/* Skills */}
      {(sk.technical?.length || sk.tools?.length || sk.languages?.length || sk.soft?.length) ? (
        <PrintSection label={isAr ? "المهارات" : "SKILLS"} accent={accent}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#3a4250", lineHeight: 1.45 }}>
            {(sk.technical?.length || 0) > 0 && (
              <div>
                <span style={{ fontWeight: 700, color: "#0F1116" }}>{isAr ? "تقنية:" : "Technical:"}</span>{" "}
                {sk.technical!.join(", ")}
              </div>
            )}
            {(sk.tools?.length || 0) > 0 && (
              <div>
                <span style={{ fontWeight: 700, color: "#0F1116" }}>{isAr ? "أدوات:" : "Tools:"}</span>{" "}
                {sk.tools!.join(", ")}
              </div>
            )}
            {(sk.languages?.length || 0) > 0 && (
              <div>
                <span style={{ fontWeight: 700, color: "#0F1116" }}>{isAr ? "اللغات:" : "Languages:"}</span>{" "}
                {sk.languages!.map((l) => `${l.name} (${l.level})`).join(", ")}
              </div>
            )}
            {(sk.soft?.length || 0) > 0 && (
              <div>
                <span style={{ fontWeight: 700, color: "#0F1116" }}>{isAr ? "مهارات عامة:" : "Soft skills:"}</span>{" "}
                {sk.soft!.join(", ")}
              </div>
            )}
          </div>
        </PrintSection>
      ) : null}

      {/* Activities */}
      {artifact.activities && artifact.activities.length > 0 && (
        <PrintSection label={isAr ? "النشاطات" : "ACTIVITIES"} accent={accent}>
          {artifact.activities.map((a, i) => (
            <div key={`pa-${i}`} style={{ marginBottom: 12 }}>
              <RowHead
                left={a.role}
                right={[a.startDate, a.endDate].filter(Boolean).join(" – ")}
              />
              <div style={{ fontSize: 12, color: "#5a6168", marginTop: 2 }}>{a.organization}</div>
              {(a.bullets ?? []).length > 0 && (
                <ul style={{ marginTop: 3, marginBottom: 0, paddingInlineStart: 18, fontSize: 12, color: "#3a4250", lineHeight: 1.5 }}>
                  {a.bullets!.map((b, j) => <li key={j} style={{ marginBottom: 2 }}>{b}</li>)}
                </ul>
              )}
            </div>
          ))}
        </PrintSection>
      )}

      {/* Certifications */}
      {artifact.certifications && artifact.certifications.length > 0 && (
        <PrintSection label={isAr ? "الشهادات" : "CERTIFICATIONS"} accent={accent}>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: "#3a4250", lineHeight: 1.55 }}>
            {artifact.certifications.map((c, i) => (
              <li key={`pc-${i}`} style={{ marginBottom: 3 }}>
                <span style={{ fontWeight: 600, color: "#0F1116" }}>{c.name}</span>
                {c.issuer && <span style={{ color: "#5a6168" }}> · {c.issuer}</span>}
                {c.date && <span style={{ color: "#5a6168" }}> · {c.date}</span>}
              </li>
            ))}
          </ul>
        </PrintSection>
      )}

      {/* Subtle footer line */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 12,
          borderTop: "1px solid #E5E3DC",
          fontSize: 9.5,
          color: "#9a9a9a",
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {isAr ? "مُولّد عبر باس أدرس" : "Generated with Bas Udrus"}
      </div>
    </div>
  );
}

function PrintSection({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2
        style={{
          margin: 0,
          marginBottom: 10,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2,
          color: accent,
          textTransform: "uppercase",
          paddingBottom: 4,
          borderBottom: "1.5px solid #E5E3DC",
        }}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}

function RowHead({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#0F1116" }}>{left}</div>
      {right && (
        <div style={{ fontSize: 11, color: "#5a6168", fontVariantNumeric: "tabular-nums" }}>{right}</div>
      )}
    </div>
  );
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}
