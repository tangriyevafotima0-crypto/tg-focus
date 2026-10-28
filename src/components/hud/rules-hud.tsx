import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineField } from "@/components/hud/inline-field";
import { useFocusStore } from "@/lib/store";
import type { CornerPosition } from "@/lib/types";
import { cn } from "@/lib/utils";

const CORNERS: { id: CornerPosition; label: string }[] = [
  { id: "topLeft", label: "Top left" },
  { id: "topRight", label: "Top right" },
  { id: "bottomLeft", label: "Bottom left" },
  { id: "bottomRight", label: "Bottom right" },
];

export function RulesHud() {
  const rules = useFocusStore((s) => s.rules);
  const corner = useFocusStore((s) => s.settings.corner);
  const setCorner = useFocusStore((s) => s.setCorner);
  const addRule = useFocusStore((s) => s.addRule);
  const updateRule = useFocusStore((s) => s.updateRule);
  const removeRule = useFocusStore((s) => s.removeRule);
  const [focusId, setFocusId] = useState<string | null>(null);

  return (
    <section
      className="hud-panel flex w-full flex-col overflow-hidden md:w-hud-rules"
      aria-label="Pinned rules"
    >
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <div className="min-w-0 flex-1">
          <p className="hud-kicker">Rules</p>
          <p className="text-xs text-muted">Pinned · non-negotiable</p>
        </div>
        <CornerPicker value={corner} onChange={setCorner} />
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Add rule"
          onClick={() => {
            const id = addRule("");
            setFocusId(id);
          }}
        >
          <Plus />
        </Button>
      </header>

      <ul className="flex flex-col px-2 pb-3">
        {rules.length === 0 ? (
          <li className="px-2 py-3 text-sm text-muted">No rules yet. Add one.</li>
        ) : (
          rules.map((rule) => (
            <li
              key={rule.id}
              className="hud-row group flex items-center gap-1 rounded-sm px-1 py-0.5"
            >
              <span
                className="mx-1 size-1 shrink-0 rounded-full bg-fg/45"
                aria-hidden
              />
              <InlineField
                value={rule.text}
                onCommit={(text) => updateRule(rule.id, text)}
                autoFocus={focusId === rule.id}
                onAutoFocusConsumed={() => setFocusId(null)}
                placeholder="Write a rule"
                className="flex-1"
              />
              <Button
                variant="quiet"
                size="icon-sm"
                aria-label={`Delete ${rule.text || "rule"}`}
                className="row-action text-muted hover:text-danger"
                onClick={() => removeRule(rule.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function CornerPicker({
  value,
  onChange,
}: {
  value: CornerPosition;
  onChange: (c: CornerPosition) => void;
}) {
  return (
    <div
      className="grid size-8 grid-cols-2 gap-0.5 rounded-xs bg-fg/8 p-0.5"
      role="group"
      aria-label="Pin corner"
    >
      {CORNERS.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-label={c.label}
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={cn(
            "relative rounded-[2px] after:absolute after:inset-[-6px]",
            value === c.id ? "bg-accent" : "bg-fg/20 hover:bg-fg/35",
          )}
        />
      ))}
    </div>
  );
}
