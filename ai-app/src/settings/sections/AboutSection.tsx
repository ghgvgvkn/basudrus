/**
 * AboutSection — version, legal links, support contact, build info.
 *
 * Vite injects build-time metadata via `import.meta.env`. We surface
 * the deploy commit if Vercel passes it as `VITE_VERCEL_GIT_COMMIT_SHA`
 * so a user can tell us "I saw the bug on commit abc123…".
 */
import { Heart, ExternalLink, Sparkles } from "lucide-react";
import { Group, Field, Note } from "./parts";

const APP_VERSION = "0.1.0";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

function getCommitSha(): string | null {
  // Vercel exposes this when the env var is added to the project.
  // It's safe to expose publicly — just a git hash.
  const sha = (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) ?? null;
  return sha ? sha.slice(0, 7) : null;
}

export function AboutSection() {
  const commit = getCommitSha();

  return (
    <>
      <Group title="Bas Udrus AI">
        <div className="px-4 py-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-accent/15 grid place-items-center shrink-0">
            <Sparkles className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-ink-1">Bas Udrus AI</div>
            <div className="text-xs text-ink-3">Tony Starrk · Sherlock · v{APP_VERSION}</div>
          </div>
        </div>
        <Field
          label="Version"
          value={`${APP_VERSION}${commit ? ` · build ${commit}` : ""}`}
          sublabel={`Built ${BUILD_DATE}`}
        />
        <Field
          label="Sister site"
          value="basudrus.com"
          sublabel="Same account, same memory. Adds Discover, Rooms, and study partners."
          action={
            <a
              href="https://basudrus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3.5 rounded-full border border-line/60 bg-surface-1 text-sm text-ink-1 hover:bg-surface-2 transition inline-flex items-center gap-1.5"
            >
              Open <ExternalLink className="h-3.5 w-3.5" />
            </a>
          }
        />
      </Group>

      <Group title="Legal">
        <LegalLink label="Terms of Service" href="https://basudrus.com/terms" />
        <LegalLink label="Privacy Policy"   href="https://basudrus.com/privacy" />
        <LegalLink label="Refund Policy"    href="https://basudrus.com/refund" />
      </Group>

      <Group title="Get in touch">
        <LegalLink label="Contact support" href="https://basudrus.com/contact" />
        <LegalLink label="Pricing"          href="https://basudrus.com/pricing" />
      </Group>

      <Note>
        <span className="inline-flex items-center gap-1.5">
          <Heart className="h-3.5 w-3.5 text-red-500" />
          Made in Amman, Jordan. Built for students worldwide.
        </span>
      </Note>

    </>
  );
}

function LegalLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="px-4 py-3.5 flex items-center gap-3 text-sm text-ink-1 hover:bg-surface-1 transition"
    >
      <span className="flex-1">{label}</span>
      <ExternalLink className="h-4 w-4 text-ink-3" />
    </a>
  );
}
