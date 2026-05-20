import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * ai-app — the AI-only front door (will deploy to ai.basudrus.com).
 *
 * Path alias scheme:
 *   @/*    → ../src/*       (Bas Udrus shared code: features/ai, features/auth,
 *                            lib, shared, context. This is the SAME alias the
 *                            shared files already use internally — `@/lib/supabase`
 *                            etc. continue to resolve unchanged, so we share by
 *                            reference, no copy-paste drift.)
 *   @ai/*  → ./src/*        (ai-app's OWN code — shell, router, AI-only screens.)
 *
 * envDir points one level up so we read the same `.env` as Bas Udrus —
 * VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY are shared across both sites.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: path.resolve(__dirname, ".."),
  resolve: {
    alias: {
      "@":   path.resolve(__dirname, "..", "src"),   // shared code (same as root project)
      "@ai": path.resolve(__dirname, "src"),          // this app's own code
    },
    // Force a single React instance even though the dep is declared in both
    // package.jsons. Without this, hooks called from @/* (shared) code fail
    // with "Invalid hook call" because they bind to a different React copy.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5174,        // Bas Udrus uses 5173 — keep them separate for local dev
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
