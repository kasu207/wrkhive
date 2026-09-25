import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brand";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#2b2b29] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
  secondary: "bg-surface text-ink border border-border-strong hover:bg-surface-2 hover:border-[#c4c3bb] shadow-card",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-surface text-critical-ink border border-border-strong hover:bg-critical-soft hover:border-[#f0c4c4]",
  brand: "bg-brand text-ink hover:bg-[#e39f00] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 rounded-[9px] px-3 text-[13px] [&_svg]:size-4",
  md: "h-10 rounded-[var(--radius-control)] px-4 text-sm [&_svg]:size-[18px]",
  lg: "h-12 rounded-[12px] px-5 text-[15px] [&_svg]:size-5",
  icon: "size-10 rounded-[var(--radius-control)] [&_svg]:size-[18px]",
  "icon-sm": "size-8 rounded-[9px] [&_svg]:size-4",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type="button" className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
