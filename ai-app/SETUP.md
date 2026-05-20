# ai-app — Deployment Setup

The AI-only front door for Bas Udrus. Same database, same auth, same memory
as basudrus.com — different shell, different domain.

This doc is the **one-time setup** to get it live on `ai.basudrus.com`. After
this, every push to `main` redeploys both sites automatically.

---

## 1. Local development

From the repo root:

```bash
pnpm install                      # one-time (workspace install hoists everything)
pnpm --filter basudrus-ai-app dev # starts ai-app on http://localhost:5174
pnpm dev                          # in another tab: Bas Udrus on http://localhost:5173
```

Both apps read the **same** `.env` at the repo root. No env duplication.

On localhost the auth cookie can't be scoped to `.basudrus.com` (cookies don't
work across `localhost` and `localhost:5174` — different origins, no shared
domain). So cross-port SSO doesn't work in dev. Sign in to each port separately.
**This is only a local-dev limitation; production SSO works because both sites
share the `.basudrus.com` cookie.**

---

## 2. Vercel — create the second project (5 min in the dashboard)

You already have a Vercel project for Bas Udrus. Add a SECOND project pointing
at the same git repo, with the root directory set to `ai-app`.

In Vercel dashboard:

1. **Add New → Project**
2. **Import** the same GitHub repo (`bas-udrus-project` or whatever it's called)
3. **Configure** with these settings:
   - **Project Name**: `basudrus-ai` (or whatever — this is the Vercel internal name)
   - **Framework Preset**: Vite (auto-detected once Vercel sees `ai-app/vite.config.ts`)
   - **Root Directory**: `ai-app`   ← **important: this is the one setting that differs from the main project**
   - **Build Command**: `pnpm build` (default)
   - **Output Directory**: `dist` (default)
   - **Install Command**: `pnpm install` (default — must be pnpm, not npm, for the workspace to resolve)
4. **Environment Variables**: copy the same vars from your existing Bas Udrus project. At minimum:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - Any other `VITE_*` vars the AI code reads
5. Click **Deploy**. First build runs.

After deploy succeeds, the project will be live at a `*.vercel.app` URL — verify
that one first before pointing the real domain.

---

## 3. DNS — point `ai.basudrus.com` at the Vercel project

In Vercel:

1. Open the new `basudrus-ai` project → **Settings → Domains**
2. **Add** → enter `ai.basudrus.com` → click Add
3. Vercel will show you the DNS record it wants. It'll be either:
   - **CNAME** `ai` → `cname.vercel-dns.com`
   - **A record** `ai` → an IP it gives you
4. Go to your DNS provider (Cloudflare / Namecheap / wherever `basudrus.com` lives)
5. Add the record Vercel told you to add
6. Back in Vercel, wait 1-2 min for propagation. Vercel will go from yellow
   "Pending" to green "Active". SSL auto-provisions.

That's it. `ai.basudrus.com` is live.

---

## 4. Verify cross-subdomain SSO end-to-end

Once both sites are live on production domains, test this:

1. Open `basudrus.com` in a fresh browser. Sign up or sign in.
2. In the same browser, open `ai.basudrus.com`.
3. **You should be signed in automatically.** The AI chat should render the
   same profile, same memory, same name.

If step 3 lands you on the sign-in screen instead:
- Open DevTools → Application → Cookies → `https://ai.basudrus.com`
- Look for a cookie whose name starts with `sb-` and has `Domain` = `.basudrus.com`
- If the cookie isn't there: the change in `src/lib/supabase.ts` (the `ssoStorage`
  adapter) didn't ship. Re-check that Bas Udrus deployed after that commit.
- If the cookie is there but the AI site still asks you to sign in: clear
  localStorage on `ai.basudrus.com`, refresh — the cookie path should win.

---

## 5. What the code change in Bas Udrus actually does

The one Bas Udrus change (in `src/lib/supabase.ts`, function `ssoStorage`) is
non-breaking and safe to roll back. It:

- **Writes** the Supabase session to **both** localStorage **and** a cookie
  with `Domain=.basudrus.com` (on production basudrus hosts only — localhost
  and Vercel previews stay localStorage-only).
- **Reads** prefer the cookie. Falls back to localStorage when the cookie
  isn't there (existing 691 users keep their session through the transition).
- **Removes** clears both on sign-out.

If anything breaks, revert that single function and the site is back to
pure-localStorage in one commit.

---

## 6. After it works — what's next

Now the AI site is a free canvas. None of this touches Bas Udrus:

- **Immersive shell** — replace the current minimal `App.tsx` with a full-bleed
  dark-mode Jarvis-style layout. Live in `ai-app/src/`.
- **Voice mode** — wire OpenAI Realtime or ElevenLabs in `ai-app/src/voice/`.
- **3D models / Jarvis view** — React Three Fiber under `ai-app/src/jarvis/`.
- **Harvey persona** — add to `src/features/ai/personaRouting.ts` (shared,
  both sites get it; gate it via subscription tier so it only shows on the
  AI site if you want).

When something becomes worth sharing back to Bas Udrus, move it from
`ai-app/src/` to `src/` and both sites see it.
