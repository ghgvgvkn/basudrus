import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Vite 5 + Tailwind 4 (beta). The `@tailwindcss/vite` plugin is the
// v4 replacement for the old postcss pipeline — it reads `@theme`
// blocks from src/index.css and generates utility classes on demand.
//
// The `@` alias matches the legacy repo's tsconfig so imports can
// be copy-pasted between projects without rewriting paths.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
