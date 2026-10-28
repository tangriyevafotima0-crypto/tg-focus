import { cn } from "@/lib/utils";

export function CornerMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("text-fg", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.5 3.5h8.2v1.7H5.2v6.5H3.5V3.5zm17 17h-8.2v-1.7h6.5v-6.5h1.7v8.2z" />
    </svg>
  );
}
