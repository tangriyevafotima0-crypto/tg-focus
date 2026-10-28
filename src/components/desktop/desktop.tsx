import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { Dock } from "@/components/desktop/dock";
import { MenuBar } from "@/components/desktop/menu-bar";
import { AboutPanel } from "@/components/hud/about-panel";
import { HistoryPanel } from "@/components/hud/history-panel";
import { MorningPrompt } from "@/components/hud/morning-prompt";
import { NotesHud } from "@/components/hud/notes-hud";
import { RulesHud } from "@/components/hud/rules-hud";
import { SettingsPanel } from "@/components/hud/settings-panel";
import { useFocusStore } from "@/lib/store";
import type { CornerPosition } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Desktop() {
  const setHydrated = useFocusStore((s) => s.setHydrated);
  const maybeShowMorningPrompt = useFocusStore((s) => s.maybeShowMorningPrompt);
  const showPrompt = useFocusStore((s) => s.showPrompt);
  const notesVisible = useFocusStore((s) => s.settings.notesVisible);
  const corner = useFocusStore((s) => s.settings.corner);
  const notesPosition = useFocusStore((s) => s.settings.notesPosition);
  const openPanel = useFocusStore((s) => s.openPanel);
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
  const toggleNotes = useFocusStore((s) => s.toggleNotes);

  const desktopRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const [focusInput, setFocusInput] = useState(false);
  const prevNotes = useRef(notesVisible);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useFocusStore.persist.rehydrate())
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setHydrated(true);
        maybeShowMorningPrompt();
      });
    return () => {
      cancelled = true;
    };
  }, [maybeShowMorningPrompt, setHydrated]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setStacked(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (notesVisible && !prevNotes.current) setFocusInput(true);
    prevNotes.current = notesVisible;
  }, [notesVisible]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        toggleNotes();
        return;
      }
      if (e.key === "Escape") {
        if (openPanel) {
          setOpenPanel(null);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPanel, setOpenPanel, toggleNotes]);

  const onFocused = useCallback(() => setFocusInput(false), []);

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/wallpaper.jpg)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-bg/25"
        aria-hidden
      />

      <MenuBar />

      <div
        ref={desktopRef}
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 pb-6 md:block md:overflow-hidden md:px-0 md:py-0 md:pb-0"
      >
        <div
          className={cn(
            "hud-float-rules transition-[top,right,bottom,left] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
            cornerClass(corner),
          )}
        >
          <RulesHud />
        </div>
        {notesVisible ? (
          <div
            className="hud-float-notes"
            style={{
              left: notesPosition.x,
              top: notesPosition.y,
            }}
          >
            <NotesHud
              stacked={stacked}
              desktopRef={desktopRef}
              requestFocus={focusInput}
              onFocused={onFocused}
            />
          </div>
        ) : null}

        <Dock />

        {showPrompt ? <MorningPrompt /> : null}
        {openPanel === "history" ? <HistoryPanel /> : null}
        {openPanel === "settings" ? <SettingsPanel /> : null}
        {openPanel === "about" ? <AboutPanel /> : null}
      </div>

      <Toaster
        theme="dark"
        position="top-center"
        offset={44}
        toastOptions={{
          classNames: {
            toast:
              "hud-panel-tight border-0 text-fg text-sm px-4 py-3 shadow-[var(--shadow-hud)]",
            title: "text-fg",
          },
        }}
      />
    </div>
  );
}

function cornerClass(corner: CornerPosition): string {
  switch (corner) {
    case "topLeft":
      return "top-6 left-6";
    case "topRight":
      return "top-6 right-6";
    case "bottomLeft":
      return "bottom-24 left-6";
    case "bottomRight":
      return "bottom-24 right-6";
  }
}
