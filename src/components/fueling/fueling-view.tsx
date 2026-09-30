"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFuelOverride } from "@/app/actions/nutrition";
import { SportTile } from "@/components/brand";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { displayDate } from "@/lib/dates";
import { formatDayLong, formatDuration } from "@/lib/format";
import type { FuelPlan, FuelProduct, FuelProfile, ProgressionAdvice, SessionFlags, TempClass } from "@/lib/nutrition";
import type { Sport } from "@/lib/workout/types";
import { FuelPlanView, fuelSummary, packingSummary } from "./fuel-plan";
import { LogPanel, type FuelLogRow } from "./log-panel";
import { PantryPanel } from "./pantry-panel";
import { ConditionsFields, Planner } from "./planner";
import { FuelSettingsCard, type FuelSettingsValues } from "./settings-card";
import type { RecentActivity } from "./shared";
import { SweatPanel, type SweatTestRow } from "./sweat-panel";

export type FuelTab = "plan" | "pantry" | "sweat" | "log";

export interface UpcomingPlan {
  scheduledId: string;
  date: string;
  workout: { id: string; name: string; sport: Sport };
  tempClass: TempClass;
  flags: SessionFlags;
  plan: FuelPlan;
}

export function FuelingView(props: {
  tab: FuelTab;
  today: string;
  profile: FuelProfile;
  settings: FuelSettingsValues;
  pantry: FuelProduct[];
  products: FuelProduct[];
  pantryIds: string[];
  upcoming: UpcomingPlan[];
  open: UpcomingPlan | null;
  tests: SweatTestRow[];
  logs: FuelLogRow[];
  activities: RecentActivity[];
  advice: ProgressionAdvice;
  activityId?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FuelTab>(props.tab);

  const go = (next: FuelTab) => {
    setTab(next);
    router.replace(next === "plan" ? "/fueling" : `/fueling?tab=${next}`, { scroll: false });
  };
  const closePlan = () => router.push(tab === "plan" ? "/fueling" : `/fueling?tab=${tab}`, { scroll: false });

  return (
    <>
      <Segmented
        className="mb-6 max-sm:flex max-sm:w-full"
        label="Bereich"
        value={tab}
        onChange={go}
        options={[
          { value: "plan", label: "Planer" },
          { value: "pantry", label: "Vorrat" },
          { value: "sweat", label: "Schweißtest" },
          { value: "log", label: "Protokoll" },
        ]}
      />

      {tab === "plan" ? (
        <div className="space-y-6">
          {props.upcoming.length ? <UpcomingCard upcoming={props.upcoming} /> : null}
          <Planner profile={props.profile} pantry={props.pantry} />
          <div className="max-w-md">
            <FuelSettingsCard initial={props.settings} weightKg={props.profile.weightKg} weightKnown={props.profile.weightKnown} />
          </div>
        </div>
      ) : tab === "pantry" ? (
        <PantryPanel products={props.products} pantryIds={props.pantryIds} />
      ) : tab === "sweat" ? (
        <SweatPanel tests={props.tests} activities={props.activities} today={props.today} preselect={props.activityId} />
      ) : (
        <LogPanel logs={props.logs} activities={props.activities} pantry={props.pantry} advice={props.advice} maxCarb={props.settings.maxCarb} today={props.today} preselect={props.activityId} />
      )}

      {props.open ? <ScheduledPlanDialog key={props.open.scheduledId} item={props.open} onClose={closePlan} /> : null}
    </>
  );
}

function UpcomingCard({ upcoming }: { upcoming: UpcomingPlan[] }) {
  return (
    <Card>
      <CardHeader title="Deine nächsten Einheiten" description="Pläne aus deinem Kalender, mit Zeitpunkten passend zu den Intervallen" />
      <ul className="divide-y divide-border pt-3">
        {upcoming.map((u) => (
          <li key={u.scheduledId}>
            <Link href={`/fueling?plan=${u.scheduledId}`} scroll={false} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
              <SportTile sport={u.workout.sport} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">
                  {u.workout.name} <span className="font-normal text-ink-3">· {formatDayLong(displayDate(u.date))} · {formatDuration(u.plan.input.durationSec, { compact: true })}</span>
                </div>
                <div className="truncate text-[12px] text-ink-3">
                  {fuelSummary(u.plan)}
                  {u.plan.schedule.packing.length ? ` · ${packingSummary(u.plan.schedule)}` : ""}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ScheduledPlanDialog({ item, onClose }: { item: UpcomingPlan; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [tempClass, setTempClass] = useState(item.tempClass);
  const [flags, setFlags] = useState(item.flags);
  const save = (t: TempClass, f: SessionFlags) => {
    setTempClass(t);
    setFlags(f);
    start(async () => {
      const r = await saveFuelOverride({ scheduledId: item.scheduledId, tempClass: t, flags: f });
      if (!r.ok) toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
      router.refresh();
    });
  };
  return (
    <Dialog open onClose={onClose} title={`Verpflegung: ${item.workout.name}`} description={formatDayLong(displayDate(item.date))} size="lg">
      <div className="mb-5 grid gap-4 rounded-xl border border-border bg-surface-2/60 p-4 sm:grid-cols-[220px_1fr]" aria-busy={pending || undefined}>
        <ConditionsFields tempClass={tempClass} onTemp={(t) => save(t, flags)} flags={flags} onFlags={(f) => save(tempClass, f)} />
      </div>
      <FuelPlanView plan={item.plan} />
    </Dialog>
  );
}
