import { Bike, Dumbbell, Footprints, Activity } from "lucide-react";
import type { Sport } from "@/lib/workout/types";
import { cn } from "@/lib/cn";

/** Wrkhive mark: a honeycomb cell with a rising interval profile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9z" fill="#F2A900" />
      <path d="M9 21.5h3v-5h3v-6h3v8h3v-3h2" fill="none" stroke="#111110" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-7" />
      <span className="text-[17px] font-semibold tracking-[-0.03em] text-ink">wrkhive</span>
    </span>
  );
}

export const SPORT_COLOR: Record<Sport | "other", string> = {
  ride: "var(--sport-ride)",
  run: "var(--sport-run)",
  strength: "var(--sport-strength)",
  other: "var(--sport-other)",
};

export function SportIcon({ sport, className }: { sport: Sport | "other"; className?: string }) {
  const Icon = sport === "ride" ? Bike : sport === "run" ? Footprints : sport === "strength" ? Dumbbell : Activity;
  return <Icon className={className} aria-hidden />;
}

/** Colored rounded tile with the sport glyph. */
export function SportTile({ sport, size = "md", className }: { sport: Sport | "other"; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = size === "sm" ? "size-7 rounded-lg [&_svg]:size-3.5" : size === "lg" ? "size-11 rounded-[13px] [&_svg]:size-5" : "size-9 rounded-[11px] [&_svg]:size-[18px]";
  return (
    <span
      className={cn("grid shrink-0 place-items-center text-white", dim, className)}
      style={{ background: SPORT_COLOR[sport] }}
    >
      <SportIcon sport={sport} />
    </span>
  );
}
