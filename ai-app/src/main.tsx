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

// Same global error → Supabase `client_errors` reporting that Bas
// Udrus uses. The shared `@bu` import means a fix to error reporting
// in the main site lands here automatically.
installGlobalErrorReporter();

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
