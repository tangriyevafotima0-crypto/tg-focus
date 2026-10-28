import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type InlineFieldProps = {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  completed?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onAutoFocusConsumed?: () => void;
};

export function InlineField({
  value,
  onCommit,
  className,
  completed = false,
  placeholder = "Untitled",
  autoFocus = false,
  onAutoFocusConsumed,
}: InlineFieldProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(autoFocus);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
      onAutoFocusConsumed?.();
    }
  }, [editing, onAutoFocusConsumed]);

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-no-drag
        onClick={() => setEditing(true)}
        className={cn(
          "relative min-h-8 w-full truncate rounded-xs px-1 text-left text-sm leading-snug text-fg",
          completed && "text-muted",
          className,
        )}
      >
        <span className="relative inline-block max-w-full">
          <span className="block truncate">{value || placeholder}</span>
          <span className={cn("strike-line", completed && "is-on")} />
        </span>
      </button>
    );
  }

  return (
    <input
      ref={ref}
      data-no-drag
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(
        "h-8 w-full rounded-xs bg-fg/8 px-1.5 text-sm text-fg outline-none",
        "placeholder:text-subtle",
        className,
      )}
    />
  );
}
