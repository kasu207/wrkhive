import { ChevronDown, ExternalLink } from "lucide-react";
import { AppMark } from "@/components/app-mark";
import { Card } from "@/components/ui/card";
import { APPS, WORKOUT_UNSUPPORTED_NOTE, type AppInfo, type AppRoute } from "@/lib/apps";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";

export interface HubConnection {
  provider: "garmin" | "wahoo" | "intervals";
  live: boolean;
}

const VIA_LABEL: Record<AppRoute["via"], string> = { garmin: "Garmin", wahoo: "Wahoo", intervals: "intervals.icu", file: "Datei", none: "" };

function status(routes: AppRoute[], conns: HubConnection[]): { route: AppRoute | null; active: boolean; demo: boolean } {
  for (const r of routes) {
    if (r.via === "file" || r.via === "none") continue;
    const c = conns.find((x) => x.provider === r.via);
    if (c) return { route: r, active: true, demo: !c.live };
  }
  const file = routes.find((r) => r.via === "file");
  return { route: file ?? routes[0] ?? null, active: false, demo: false };
}

function Flow({ label, routes, conns, emptyNote, lastSeen }: { label: string; routes: AppRoute[]; conns: HubConnection[]; emptyNote?: string; lastSeen?: number | null }) {
  if (!routes.length) {
    return (
      <p className="flex gap-2 text-[13px] leading-relaxed text-ink-3">
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-surface-3" />
        <span>
          <span className="font-medium text-ink-2">{label}:</span> {emptyNote}
        </span>
      </p>
    );
  }
  const s = status(routes, conns);
  return (
    <p className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", s.active ? (s.demo ? "bg-brand" : "bg-good") : "bg-surface-3")} />
      <span>
        <span className="font-medium text-ink">{label}:</span>{" "}
        {s.active
          ? `über ${VIA_LABEL[s.route!.via]}${s.demo ? " (Demo)" : ""}`
          : routes.some((r) => r.via !== "file")
            ? `noch nicht eingerichtet${routes.some((r) => r.via === "file") ? ", Datei geht immer" : ""}`
            : "als Datei"}
        {lastSeen ? <span className="text-ink-3"> · zuletzt {relativeTime(lastSeen)}</span> : null}
      </span>
    </p>
  );
}

/**
 * Overview of the athlete's apps and devices: where activities come from and
 * where workouts go, with the one-time setup steps for each.
 */
export function AppHub({ selected, conns, lastSeen }: { selected: string[]; conns: HubConnection[]; lastSeen: Partial<Record<AppInfo["id"], number>> }) {
  const mine = APPS.filter((a) => selected.includes(a.id));
  const others = APPS.filter((a) => !selected.includes(a.id));
  const list = [...mine, ...others];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((app) => {
        const used = selected.includes(app.id) || lastSeen[app.id] !== undefined;
        return (
          <Card key={app.id} className={cn("flex flex-col p-4", !used && selected.length > 0 && "opacity-80")}>
            <div className="flex items-center gap-3">
              <AppMark id={app.id} />
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">{app.name}</h3>
                <p className="truncate text-[12px] text-ink-3">{app.tagline}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Flow label="Aktivitäten" routes={app.activities} conns={conns} lastSeen={lastSeen[app.id]} />
              <Flow label="Workouts" routes={app.workouts} conns={conns} emptyNote={WORKOUT_UNSUPPORTED_NOTE[app.id] ?? "nicht möglich"} />
            </div>
            <details className="group mt-3 border-t border-border pt-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                So richtest du es ein
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-2">
                <ul className="space-y-1">
                  {app.activities.concat(app.workouts).map((r, i) => (
                    <li key={i} className="text-ink-3">
                      {i < app.activities.length ? "Aktivitäten" : "Workouts"}: {r.text}
                    </li>
                  ))}
                </ul>
                <ol className="list-decimal space-y-1 pl-4">
                  {app.setup.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {app.link ? (
                  <a href={app.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-focus hover:underline">
                    {app.link.label} <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
