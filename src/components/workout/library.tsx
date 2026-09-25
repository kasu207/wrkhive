"use client";

import { Search, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createFromTemplate, toggleFavorite } from "@/app/actions/workouts";
import { SportIcon, SportTile } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDistance, formatDuration, relativeTime } from "@/lib/format";
import { CATEGORY_LABEL, type WorkoutTemplate } from "@/lib/workout/templates";
import { SPORT_LABEL, type Sport, type Thresholds, type WorkoutStructure } from "@/lib/workout/types";
import { WorkoutSparkline } from "./workout-chart";

export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  sport: Sport;
  structure: WorkoutStructure;
  durationSec: number;
  distanceM: number;
  tss: number;
  favorite: boolean;
  source: "manual" | "coach" | "template" | "plan";
  updatedAt: number;
}

type Filter = "all" | Sport;

export function WorkoutLibrary({ items, templates, thresholds, templateStructures }: { items: LibraryItem[]; templates: WorkoutTemplate[]; thresholds: Thresholds; templateStructures: Record<string, WorkoutStructure> }) {
  const [tab, setTab] = useState<"mine" | "templates">(items.some((i) => i.source !== "plan") ? "mine" : "templates");
  const [sport, setSport] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  const q = query.trim().toLowerCase();
  const mine = useMemo(
    () =>
      items.filter(
        (i) =>
          (sport === "all" || i.sport === sport) &&
          (!favOnly || i.favorite) &&
          (showPlan || i.source !== "plan") &&
          (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
      ),
    [items, sport, favOnly, showPlan, q],
  );
  const tpl = useMemo(
    () => templates.filter((t) => (sport === "all" || t.sport === sport) && (!q || t.name.toLowerCase().includes(q) || CATEGORY_LABEL[t.category].toLowerCase().includes(q))),
    [templates, sport, q],
  );
  const planCount = items.filter((i) => i.source === "plan").length;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={tab}
          onChange={setTab}
          label="Ansicht"
          options={[
            { value: "mine", label: `Meine Workouts` },
            { value: "templates", label: "Vorlagen" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Workouts durchsuchen" />
          </div>
          <Segmented
            value={sport}
            onChange={setSport}
            label="Sportart"
            options={[
              { value: "all", label: "Alle" },
              ...(["ride", "run", "strength"] as Sport[]).map((s) => ({
                value: s,
                label: (
                  <>
                    <SportIcon sport={s} />
                    <span className="hidden sm:inline">{SPORT_LABEL[s]}</span>
                  </>
                ),
              })),
            ]}
          />
        </div>
      </div>

      {tab === "mine" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterChip active={favOnly} onClick={() => setFavOnly((v) => !v)}>
              <Star className="size-3.5" /> Favoriten
            </FilterChip>
            {planCount ? (
              <FilterChip active={showPlan} onClick={() => setShowPlan((v) => !v)}>
                Einheiten aus Plänen ({planCount})
              </FilterChip>
            ) : null}
          </div>
          {mine.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {mine.map((w, i) => (
                <WorkoutCard key={w.id} item={w} thresholds={thresholds} index={i} />
              ))}
            </div>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface">
              <EmptyState
                title={items.length ? "Nichts gefunden" : "Noch keine eigenen Workouts"}
                description={items.length ? "Passe Suche oder Filter an." : "Erstelle dein erstes Workout oder starte mit einer Vorlage."}
                action={
                  <div className="flex gap-2">
                    <Link href="/workouts/new" className="inline-flex h-10 items-center rounded-[10px] bg-ink px-4 text-sm font-medium text-white">
                      Neues Workout
                    </Link>
                    <Button variant="secondary" onClick={() => setTab("templates")}>
                      Vorlagen ansehen
                    </Button>
                  </div>
                }
              />
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tpl.map((t, i) => (
            <TemplateCard key={t.id} template={t} structure={templateStructures[t.id]} thresholds={thresholds} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
        active ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const SOURCE_LABEL = { coach: "Coach", plan: "Plan", template: "Vorlage", manual: null } as const;

function WorkoutCard({ item, thresholds, index }: { item: LibraryItem; thresholds: Thresholds; index: number }) {
  const [fav, setFav] = useState(item.favorite);
  const [, start] = useTransition();
  return (
    <div className="group relative animate-fade-up" style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}>
      <Link
        href={`/workouts/${item.id}`}
        className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised"
      >
        <div className="flex items-start gap-3 pr-8">
          <SportTile sport={item.sport} />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{item.name}</h3>
            <p className="text-[13px] text-ink-3 tabular">
              {formatDuration(item.durationSec, { compact: true })}
              {item.sport === "run" && item.distanceM ? ` · ${formatDistance(item.distanceM)}` : ""} · {item.tss} TSS
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-lg bg-surface-2/70 px-2 pt-2">
          <WorkoutSparkline structure={item.structure} thresholds={thresholds} height={44} />
        </div>
        <div className="mt-3 flex items-center justify-between text-[12px] text-ink-3">
          <span>Bearbeitet {relativeTime(item.updatedAt)}</span>
          {SOURCE_LABEL[item.source] ? <Badge>{SOURCE_LABEL[item.source]}</Badge> : null}
        </div>
      </Link>
      <button
        type="button"
        aria-label={fav ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        aria-pressed={fav}
        onClick={() => {
          setFav((f) => !f);
          start(() => toggleFavorite(item.id).then(() => undefined));
        }}
        className={cn(
          "absolute right-3 top-3 grid size-8 place-items-center rounded-lg transition-colors",
          fav ? "text-brand" : "text-ink-3 opacity-100 hover:bg-surface-2 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100",
        )}
      >
        <Star className="size-[18px]" fill={fav ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

function TemplateCard({ template, structure, thresholds, index }: { template: WorkoutTemplate; structure: WorkoutStructure; thresholds: Thresholds; index: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <div
      className="flex animate-fade-up flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card"
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
    >
      <div className="flex items-start gap-3">
        <SportTile sport={template.sport} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{template.name}</h3>
          <p className="text-[13px] text-ink-3">{CATEGORY_LABEL[template.category]}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{template.description}</p>
      <div className="mt-3 rounded-lg bg-surface-2/70 px-2 pt-2">
        <WorkoutSparkline structure={structure} thresholds={thresholds} height={40} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await createFromTemplate(template.id);
              if (r.ok) router.push(`/workouts/${r.data!.id}`);
              else toast({ tone: "error", title: "Fehler", description: r.error });
            })
          }
        >
          Verwenden
        </Button>
      </div>
    </div>
  );
}
