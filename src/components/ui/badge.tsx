import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "good" | "warning" | "critical" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-border",
  brand: "bg-brand-soft text-brand-ink border-[#f5dd9c]",
  good: "bg-good-soft text-good-ink border-[#c9e9c9]",
  warning: "bg-warning-soft text-warning-ink border-[#f5dca6]",
  critical: "bg-critical-soft text-critical-ink border-[#f2caca]",
  info: "bg-[#eaf2fc] text-[#1c5cab] border-[#cde2fb]",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium [&_svg]:size-3.5", tones[tone], className)}
      {...props}
    />
  );
}
