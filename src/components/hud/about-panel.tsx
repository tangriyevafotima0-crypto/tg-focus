import { X } from "lucide-react";
import { CornerMark } from "@/components/mark";
import { Button } from "@/components/ui/button";
import { useFocusStore } from "@/lib/store";

export function AboutPanel() {
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        className="backdrop-in absolute inset-0 bg-bg/45"
        aria-label="Close about"
        onClick={() => setOpenPanel(null)}
      />
      <section
        role="dialog"
        aria-labelledby="about-title"
        className="hud-panel modal-in relative z-10 w-full max-w-sm px-7 py-7 text-center"
      >
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Close about"
          className="absolute top-3 right-3"
          onClick={() => setOpenPanel(null)}
        >
          <X />
        </Button>
        <CornerMark className="mx-auto mb-4 size-8" />
        <h2 id="about-title" className="font-display text-3xl font-medium italic">
          FocusCorner
        </h2>
        <p className="mt-3 text-sm leading-normal text-pretty text-muted">
          A quiet overlay for deep work. Rules stay pinned to a corner. Notes
          stay optional. History is a permanent markdown log.
        </p>
        <p className="mt-5 font-mono text-xs text-subtle">macOS 13+ overlay</p>
      </section>
    </div>
  );
}
