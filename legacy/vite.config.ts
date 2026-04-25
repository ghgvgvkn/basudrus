import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { compression } from "vite-plugin-compression2";

function inlineCssPlugin(): Plugin {
  return {
    name: "inline-css",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const cssAssets = Object.values(ctx.bundle).filter(
          (a): a is Extract<typeof a, { type: "asset" }> =>
            a.type === "asset" && a.fileName.endsWith(".css"),
        );
        for (const css of cssAssets) {
          const linkTag = new RegExp(
            `<link[^>]*href="[^"]*${css.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
          );
          const source =
            typeof css.source === "string"
              ? css.source
              : new TextDecoder().decode(css.source);
          html = html.replace(linkTag, `<style>${source}</style>`);
          delete ctx.bundle[css.fileName];
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    inlineCssPlugin(),
    compression({ algorithm: "gzip", exclude: [/\.(png|jpg|jpeg|gif|woff2?)$/i] }),
    compression({ algorithm: "brotliCompress", exclude: [/\.(png|jpg|jpeg|gif|woff2?)$/i] }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
});
