import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import App from "./App";
import "./index.css";

// Vercel Web Analytics — non-React inject avoids duplicate-React dep pitfalls in Vite.
inject();

// Swallow benign Supabase auth-js IndexedDB lock race errors that surface briefly during
// rapid auth transitions (landing → signup → onboarding). They do not affect user flow.
const isBenignIdbError = (msg: string) =>
  /NotFoundError: The object can not be found here|Lock broken by another request/i.test(msg);
window.addEventListener("error", (e) => {
  if (e?.message && isBenignIdbError(e.message)) { e.preventDefault?.(); }
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e?.reason && (e.reason.message || e.reason)) || "");
  if (isBenignIdbError(msg)) { e.preventDefault?.(); }
});

createRoot(document.getElementById("root")!).render(<App />);
