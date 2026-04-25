import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "./index.css";
import App from "./App";
import { installGlobalErrorReporter } from "@/shared/errorReporter";

// Capture window-level errors + unhandled rejections to the Supabase
// `client_errors` table for post-hoc review. Called before mount so
// any error during initial render gets caught by the global handlers
// even before the React ErrorBoundary takes over.
installGlobalErrorReporter();

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
