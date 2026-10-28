import { cn } from "@/lib/utils";

export function Separator({ className }: { className?: string }) {
  return (
    <div
      role="separator"
      className={cn("h-px w-full bg-fg/10", className)}
    />
  );
}
