import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-11 w-full rounded-md bg-fg/6 px-3 text-sm text-fg",
        "placeholder:text-subtle",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
        "outline-none transition-[box-shadow,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        "focus-visible:bg-fg/8 focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
