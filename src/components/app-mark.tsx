import { APPS, type AppInfo } from "@/lib/apps";
import { cn } from "@/lib/cn";

const APP_COLOR: Record<AppInfo["id"], string> = {
  garmin: "bg-[#111110]",
  wahoo: "bg-[#1a4fd6]",
  zwift: "bg-[#fc6719]",
  mywhoosh: "bg-[#0b7a75]",
  rouvy: "bg-[#4a2fd0]",
  freeletics: "bg-[#2b2b2b]",
};

/** Neutral initial tile for an app (no third-party logos). */
export function AppMark({ id, className }: { id: AppInfo["id"]; className?: string }) {
  const name = APPS.find((a) => a.id === id)?.name ?? id;
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-[14px] font-bold text-white", APP_COLOR[id], className)}>
      {name[0]}
    </span>
  );
}
