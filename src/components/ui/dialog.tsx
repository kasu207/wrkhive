"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal built on the native <dialog> element (focus trap, Esc and
 * inert background come for free). Closes on backdrop click.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] overflow-hidden rounded-[18px] border border-border bg-surface p-0 text-ink shadow-overlay open:animate-pop",
        size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl",
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-32px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
              {description ? <p className="mt-0.5 text-[13px] text-ink-3">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Schließen">
              <X className="size-[18px]" />
            </button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/60 px-6 py-3.5">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
