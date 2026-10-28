import { Wifi, BatteryFull } from "lucide-react";
import { useEffect, useState } from "react";
import { CornerMark } from "@/components/mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFocusStore } from "@/lib/store";
import { cn, formatClock, formatDuration } from "@/lib/utils";

export function MenuBar() {
  const notesVisible = useFocusStore((s) => s.settings.notesVisible);
  const toggleNotes = useFocusStore((s) => s.toggleNotes);
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
  const reopenMorning = useFocusStore((s) => s.reopenMorning);
  const sessionStartedAt = useFocusStore((s) => s.settings.sessionStartedAt);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed =
    now && sessionStartedAt && notesVisible
      ? formatDuration(now.getTime() - new Date(sessionStartedAt).getTime())
      : null;

  return (
    <header className="relative z-50 flex h-8 shrink-0 items-center bg-bg/55 px-2 text-xs text-fg backdrop-blur-xl">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-xs px-1.5 font-medium hover:bg-fg/10"
            aria-label="FocusCorner menu"
          >
            <CornerMark className="size-3.5" />
            <span>FocusCorner</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setOpenPanel("about")}>
            About FocusCorner
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => toggleNotes()}>
            {notesVisible ? "Hide notes" : "Show notes"}
            <DropdownMenuShortcut>⌘⇧F</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenPanel("history")}>
            Open history.md
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenPanel("settings")}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => reopenMorning()}>
            Morning check-in
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {elapsed ? (
        <span className="ml-2 hidden items-center gap-1.5 rounded-full bg-fg/8 px-2 py-0.5 font-mono tabular-nums text-muted sm:inline-flex">
          <span className="size-1.5 rounded-full bg-sage" />
          {elapsed}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-3 pr-1 text-fg/90">
        <Wifi className="hidden size-3.5 sm:block" aria-hidden />
        <BatteryFull className="hidden size-3.5 sm:block" aria-hidden />
        <time
          className={cn("tabular-nums tracking-wide")}
          dateTime={now ? now.toISOString() : undefined}
          suppressHydrationWarning
        >
          {now ? formatClock(now) : "\u00a0"}
        </time>
      </div>
    </header>
  );
}
