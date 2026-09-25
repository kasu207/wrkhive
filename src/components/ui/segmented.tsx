"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  size?: "sm" | "md";
  className?: string;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[11px] bg-surface-2 p-[3px] ring-1 ring-inset ring-border", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-all duration-150 disabled:opacity-40 [&_svg]:size-4",
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-[13px]",
              active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(17_17_16/0.08),0_0_0_1px_rgb(17_17_16/0.04)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
