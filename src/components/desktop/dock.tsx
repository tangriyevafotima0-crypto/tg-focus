import { Folder, StickyNote, Terminal } from "lucide-react";
import { CornerMark } from "@/components/mark";
import { useFocusStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Dock() {
  const notesVisible = useFocusStore((s) => s.settings.notesVisible);
  const toggleNotes = useFocusStore((s) => s.toggleNotes);
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);

  return (
    <nav
      aria-label="Dock"
      className="pointer-events-none absolute inset-x-0 bottom-2 z-30 hidden justify-center md:flex"
    >
      <div className="pointer-events-auto flex items-end gap-2 rounded-xl bg-fg/8 px-2.5 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-xl">
        <DockIcon label="Files" icon={<Folder className="size-5" />} muted />
        <DockIcon
          label="Notes"
          icon={<StickyNote className="size-5" />}
          active={notesVisible}
          onClick={() => toggleNotes()}
        />
        <DockIcon
          label="History"
          icon={<Terminal className="size-5" />}
          onClick={() => setOpenPanel("history")}
        />
        <span className="mx-0.5 h-8 w-px bg-fg/15" aria-hidden />
        <DockIcon
          label="FocusCorner"
          icon={<CornerMark className="size-5" />}
          active
          onClick={() => setOpenPanel("about")}
        />
      </div>
    </nav>
  );
}

function DockIcon({
  label,
  icon,
  active,
  muted,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "flex size-11 items-center justify-center rounded-lg text-fg",
        "bg-fg/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
        "transition-[background-color,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        "hover:bg-fg/16 pressable",
        muted && "opacity-55",
        active && "bg-fg/18",
      )}
    >
      {icon}
    </button>
  );
}
