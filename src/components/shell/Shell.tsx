/**
 * Shell — top-level layout for authenticated screens.
 *
 * Desktop (lg+): fixed left Sidebar (248px) + main column.
 * Mobile: TopBar (48px) + scroll area + MobileNav (64px).
 *
 * Screens render inside `children`. Each screen can customise the
 * mobile TopBar by passing a `topBar` slot via React context — for
 * slice 2 we keep it simple: screens render their own TopBar at the
 * top of their tree, Shell just provides spacing/chrome.
 *
 * Cmd+K / Ctrl+K toggles the CommandPalette. Long-press AI (Omar) in
 * MobileNav opens the same palette.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { usePhotoGuard } from "@/features/profile/usePhotoGuard";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { CommandPalette } from "./CommandPalette";
import { PostComposer } from "@/features/discover/PostComposer";
import { PhotoGateModal } from "@/features/profile/PhotoGateModal";

export interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { screen, openPostComposer } = useApp();
  const { dir } = useLocale();
  const { requirePhoto } = usePhotoGuard();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Sidebar's "Post for help" button — gated on profile photo so
  // help posts always carry a recognisable identity.
  const guardedOpenPostComposer = () => {
    requirePhoto(openPostComposer, "Please upload your profile photo first so other students know who's asking for help.");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Expose `window.__basOpenPalette` so screens (TopBar search icon)
  // can open the palette without threading the callback through
  // every wrapping component.
  useEffect(() => {
    (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette =
      () => setPaletteOpen(true);
    return () => {
      delete (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette;
    };
  }, []);

  return (
    <div
      dir={dir}
      className="min-h-dvh bg-surface-0 text-ink-2"
      data-screen={screen}
    >
      <div className="hidden lg:block fixed inset-y-0 start-0 w-[248px] border-e border-line bg-surface-1 z-30">
        <Sidebar onOpenPalette={() => setPaletteOpen(true)} onNewPost={guardedOpenPostComposer} />
      </div>

      <main className="lg:ps-[248px] pb-[72px] lg:pb-0 min-h-dvh">
        {children}
      </main>

      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30">
        <MobileNav onOpenPalette={() => setPaletteOpen(true)} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Global post-for-help modal. Triggered from Home, Discover,
          Sidebar and MobileNav — mounted once here so the same
          instance (and its form state) is shared. */}
      <PostComposer />

      {/* Singleton modal for the "you need a profile photo first" gate.
          Opened imperatively by usePhotoGuard.requirePhoto / openPhotoGate. */}
      <PhotoGateModal />
    </div>
  );
}
