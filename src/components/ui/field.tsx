import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px] text-ink shadow-[inset_0_1px_1px_rgb(17_17_16/0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 hover:border-[#c4c3bb] focus:border-focus focus:shadow-[0_0_0_3px_rgb(42_120_214/0.15)] disabled:bg-surface-2 disabled:text-ink-3 aria-[invalid=true]:border-critical";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "h-10 appearance-none pr-9")} {...props}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  suffix,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  suffix?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
          {label}
        </label>
        {suffix}
      </div>
      {children}
      {error ? <p className="text-[13px] text-critical-ink">{error}</p> : hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** Number input with a unit suffix inside the control. */
export function UnitInput({ unit, className, ...props }: ComponentProps<"input"> & { unit: string }) {
  return (
    <div className={cn("relative", className)}>
      <input className={cn(control, "h-10 pr-12 tabular")} {...props} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">{unit}</span>
    </div>
  );
}
