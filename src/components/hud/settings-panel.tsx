import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useFocusStore } from "@/lib/store";
import type { CornerPosition } from "@/lib/types";
import { cn } from "@/lib/utils";

const CORNERS: { id: CornerPosition; label: string }[] = [
  { id: "topLeft", label: "Top left" },
  { id: "topRight", label: "Top right" },
  { id: "bottomLeft", label: "Bottom left" },
  { id: "bottomRight", label: "Bottom right" },
];

export function SettingsPanel() {
  const settings = useFocusStore((s) => s.settings);
  const setCorner = useFocusStore((s) => s.setCorner);
  const setLaunchAtLogin = useFocusStore((s) => s.setLaunchAtLogin);
  const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
  const reopenMorning = useFocusStore((s) => s.reopenMorning);
  const resetWorkspace = useFocusStore((s) => s.resetWorkspace);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        className="backdrop-in absolute inset-0 bg-bg/45"
        aria-label="Close settings"
        onClick={() => setOpenPanel(null)}
      />
      <section
        role="dialog"
        aria-labelledby="settings-title"
        className="hud-panel modal-in relative z-10 w-full max-w-md overflow-hidden"
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <h2
              id="settings-title"
              className="hud-kicker"
            >
              Settings
            </h2>
            <p className="text-xs text-muted">Pin, boot, overlay</p>
          </div>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Close settings"
            onClick={() => setOpenPanel(null)}
          >
            <X />
          </Button>
        </header>

        <div className="flex flex-col gap-4 px-4 pb-5">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Rules corner</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCorner(c.id)}
                  className={cn(
                    "h-11 rounded-sm text-sm transition-colors duration-[var(--motion-quick)]",
                    settings.corner === c.id
                      ? "bg-accent text-accent-fg"
                      : "bg-fg/6 text-fg hover:bg-fg/10",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <ToggleRow
            label="Launch at login"
            hint="Show the morning prompt on boot"
            on={settings.launchAtLogin}
            onChange={setLaunchAtLogin}
          />

          <Separator />

          <div className="flex flex-col gap-2">
            <Button variant="ghost" onClick={reopenMorning}>
              Simulate morning boot
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                resetWorkspace();
              }}
            >
              Reset workspace
            </Button>
          </div>

          <p className="font-mono text-xs leading-relaxed text-subtle">
            ~/.focus_corner/rules.json
            <br />
            ~/.focus_corner/tasks.json
            <br />
            ~/.focus_corner/history.md
          </p>
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex min-h-11 w-full items-center gap-3 rounded-sm text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span
        className={cn(
          "flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-[var(--motion-quick)]",
          on ? "bg-accent" : "bg-fg/15",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "size-5 rounded-full transition-transform duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
            on ? "translate-x-4 bg-accent-fg" : "translate-x-0 bg-fg/80",
          )}
        />
      </span>
    </button>
  );
}
