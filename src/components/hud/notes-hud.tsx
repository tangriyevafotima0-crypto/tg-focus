import { Check, GripHorizontal, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineField } from "@/components/hud/inline-field";
import { useFocusStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type NotesHudProps = {
  stacked: boolean;
  desktopRef: React.RefObject<HTMLDivElement | null>;
  requestFocus: boolean;
  onFocused: () => void;
};

export function NotesHud({
  stacked,
  desktopRef,
  requestFocus,
  onFocused,
}: NotesHudProps) {
  const tasks = useFocusStore((s) => s.tasks);
  const pos = useFocusStore((s) => s.settings.notesPosition);
  const setNotesPosition = useFocusStore((s) => s.setNotesPosition);
  const setNotesVisible = useFocusStore((s) => s.setNotesVisible);
  const addTask = useFocusStore((s) => s.addTask);
  const updateTask = useFocusStore((s) => s.updateTask);
  const toggleTask = useFocusStore((s) => s.toggleTask);
  const removeTask = useFocusStore((s) => s.removeTask);
  const clearCompleted = useFocusStore((s) => s.clearCompleted);

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
  } | null>(null);

  const remaining = tasks.filter((t) => !t.completed).length;
  const done = tasks.filter((t) => t.completed).length;

  useEffect(() => {
    if (requestFocus) {
      inputRef.current?.focus();
      onFocused();
    }
  }, [requestFocus, onFocused]);

  function submit() {
    addTask(draft);
    setDraft("");
  }

  function onPointerDown(e: React.PointerEvent) {
    if (stacked) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, a, [data-no-drag]")) return;
    const rect = desktopRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = {
      dx: e.clientX,
      dy: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const desk = desktopRef.current;
    const panel = panelRef.current;
    if (!desk || !panel) return;
    const dx = e.clientX - drag.current.dx;
    const dy = e.clientY - drag.current.dy;
    const maxX = Math.max(16, desk.clientWidth - panel.offsetWidth - 16);
    const maxY = Math.max(40, desk.clientHeight - panel.offsetHeight - 16);
    const x = Math.min(maxX, Math.max(16, drag.current.startX + dx));
    const y = Math.min(maxY, Math.max(40, drag.current.startY + dy));
    setNotesPosition({ x, y });
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <section
      ref={panelRef}
      className={cn(
        "hud-panel flex w-full flex-col overflow-hidden md:w-hud-notes",
        !stacked && "cursor-grab active:cursor-grabbing",
      )}
      aria-label="Today notes"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <div className="min-w-0 flex-1">
          <p className="hud-kicker">Today</p>
          <p className="text-xs tabular-nums text-muted">
            {remaining} remaining
            {done > 0 ? ` · ${done} done` : ""}
          </p>
        </div>
        {!stacked ? (
          <GripHorizontal className="size-4 text-subtle" aria-hidden />
        ) : null}
        {done > 0 ? (
          <Button
            variant="quiet"
            size="sm"
            className="h-8 px-2 text-xs text-muted"
            onClick={clearCompleted}
          >
            Clear done
          </Button>
        ) : null}
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Hide notes"
          onClick={() => setNotesVisible(false)}
        >
          <Minus />
        </Button>
      </header>

      <ul className="flex max-h-72 flex-col overflow-y-auto px-2">
        {tasks.length === 0 ? (
          <li className="px-2 py-5 text-sm text-muted">
            Nothing queued. Add a task to start.
          </li>
        ) : (
          tasks.map((task) => (
            <li
              key={task.id}
              className="hud-row flex items-center gap-1 rounded-sm px-1 py-0.5"
            >
              <button
                type="button"
                data-no-drag
                aria-label={task.completed ? "Mark not done" : "Mark done"}
                aria-pressed={task.completed}
                onClick={() => {
                  const completing = !task.completed;
                  toggleTask(task.id);
                  if (completing) {
                    toast("Appended to history.md");
                  }
                }}
                className={cn(
                  "relative mx-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs",
                  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
                  "after:absolute after:inset-[-12px]",
                  task.completed && "bg-sage text-accent-fg shadow-none",
                )}
              >
                {task.completed ? <Check className="size-3" strokeWidth={3} /> : null}
              </button>
              <InlineField
                value={task.title}
                completed={task.completed}
                onCommit={(title) => updateTask(task.id, title)}
                className="flex-1"
              />
              <Button
                variant="quiet"
                size="icon-sm"
                aria-label={`Delete ${task.title}`}
                className="row-action text-muted hover:text-danger"
                onClick={() => {
                  removeTask(task.id);
                  toast("Removed and logged");
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))
        )}
      </ul>

      <form
        className="flex items-center gap-1.5 px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Plus className="size-3.5 shrink-0 text-subtle" aria-hidden />
        <input
          ref={inputRef}
          data-no-drag
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New task"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
      </form>
    </section>
  );
}
