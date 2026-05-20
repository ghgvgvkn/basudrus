/**
 * useSettingsState — open/close + which section is active.
 *
 * Tiny module-level store (no Context provider needed) so any
 * component anywhere in the AI app can open Settings with a
 * specific section. Pattern matches how the existing MemoryModal
 * is triggered from the AIScreen sidebar.
 */
import { useEffect, useState } from "react";

export type SettingsSection =
  | "account"
  | "subscription"
  | "usage"
  | "memory"
  | "appearance"
  | "notifications"
  | "data"
  | "about";

const SECTIONS: SettingsSection[] = [
  "account",
  "subscription",
  "usage",
  "memory",
  "appearance",
  "notifications",
  "data",
  "about",
];

type Listener = (open: boolean, section: SettingsSection) => void;

let _open = false;
let _section: SettingsSection = "account";
const _listeners = new Set<Listener>();

function notify() {
  for (const l of _listeners) l(_open, _section);
}

export function openSettings(section: SettingsSection = "account") {
  _open = true;
  _section = section;
  notify();
}

export function closeSettings() {
  _open = false;
  notify();
}

export function setSettingsSection(section: SettingsSection) {
  _section = section;
  notify();
}

/** All sections in order — used by the sidebar nav. */
export function listSections(): SettingsSection[] {
  return SECTIONS.slice();
}

export function useSettingsState() {
  const [open, setOpen] = useState(_open);
  const [section, setSection] = useState<SettingsSection>(_section);
  useEffect(() => {
    const listener: Listener = (o, s) => { setOpen(o); setSection(s); };
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);
  // Esc closes when open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSettings(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, section };
}
