import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { historyMarkdown, useFocusStore } from "@/lib/store";
import { formatStamp } from "@/lib/utils";

export function HistoryPanel() {
  const history = useFocusStore((s) => s.history);
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
  const md = historyMarkdown(history);

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      toast("Copied history.md");
    } catch {
      toast("Could not copy");
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        className="backdrop-in absolute inset-0 bg-bg/45"
        aria-label="Close history"
        onClick={() => setOpenPanel(null)}
      />
      <section
        role="dialog"
        aria-labelledby="history-title"
        className="hud-panel modal-in relative z-10 flex max-h-96 w-full max-w-lg flex-col overflow-hidden"
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <h2
              id="history-title"
              className="hud-kicker"
            >
              history.md
            </h2>
            <p className="font-mono text-xs text-muted">~/.focus_corner/history.md</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={copy}>
            Copy
          </Button>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Close history"
            onClick={() => setOpenPanel(null)}
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Completed and deleted tasks land here as a permanent log.
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5 pt-1">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex gap-3 rounded-sm bg-fg/4 px-3 py-2.5"
                >
                  <span
                    className={
                      entry.kind === "completed"
                        ? "font-mono text-xs text-sage"
                        : "font-mono text-xs text-danger"
                    }
                  >
                    {entry.kind === "completed" ? "[x]" : "[del]"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{entry.title}</p>
                    <p className="font-mono text-xs tabular-nums text-subtle">
                      {formatStamp(entry.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
