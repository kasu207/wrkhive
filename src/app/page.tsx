import { ArrowRight, BarChart3, CalendarDays, Check, MessageSquare, Send, Type } from "lucide-react";
import Link from "next/link";
import { DemoButton } from "@/components/auth-forms";
import { Logo, SportTile } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { WorkoutChart } from "@/components/workout/workout-chart";
import { getCurrentUser } from "@/lib/server/auth";
import { summarize } from "@/lib/workout/metrics";
import { parseWorkoutText } from "@/lib/workout/text";
import { DEFAULT_THRESHOLDS } from "@/lib/workout/types";

const HERO_TEXT = "Aufwärmen 12min 50-70%\n3x (1min 105%, Erholung 1min 50%)\n4x (4min 110-118%, Erholung 3min 50%)\n2x (8min 88-94%, Erholung 4min 55%)\nCool-down 10min 50%";

export default async function Home() {
  const user = await getCurrentUser();
  const hero = parseWorkoutText(HERO_TEXT, "ride", DEFAULT_THRESHOLDS).structure;
  const heroSummary = summarize(hero, DEFAULT_THRESHOLDS);

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-30 border-b border-transparent bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-5 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-2">
            {user ? (
              <ButtonLink href="/dashboard" size="sm">
                Zur App
                <ArrowRight />
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost" size="sm">
                  Anmelden
                </ButtonLink>
                <ButtonLink href="/signup" size="sm">
                  Kostenlos starten
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-[1160px] items-center gap-12 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:pt-20">
        <div className="animate-fade-up">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-[13px] font-medium text-ink-2">
            <span className="size-1.5 rounded-full bg-good" /> Garmin & Wahoo · Rad, Laufen, Kraft
          </p>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[56px]">
            Workout bauen.
            <br />
            Aufs Gerät senden.
            <br />
            <span className="text-ink-3">Fertig.</span>
          </h1>
          <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-ink-2">
            Tippe dein Training so, wie du es deinem Trainingspartner erzählen würdest, oder klick es visuell zusammen. Wrkhive schickt es mit einem Klick an deine Uhr oder deinen Radcomputer und zeigt dir, wie deine Form sich entwickelt.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {user ? (
              <ButtonLink href="/workouts/new" size="lg">
                Neues Workout
                <ArrowRight />
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/signup" size="lg">
                  Kostenlos starten
                  <ArrowRight />
                </ButtonLink>
                <DemoButton />
              </>
            )}
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-2">
            {["Keine Kreditkarte", "FIT- & ZWO-Export", "Dauer-Sync deiner Aktivitäten"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-good" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Product visual */}
        <div className="animate-fade-up [animation-delay:120ms]">
          <div className="relative rounded-[22px] border border-border bg-bg p-3 shadow-overlay sm:p-4">
            <div className="rounded-[16px] border border-border bg-surface p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <SportTile sport="ride" />
                  <div>
                    <div className="text-[16px] font-semibold tracking-[-0.01em]">VO2max & Sweet Spot</div>
                    <div className="text-[13px] text-ink-3 tabular">
                      {Math.round(heroSummary.durationSec / 60)} min · {heroSummary.tss} TSS · IF {heroSummary.intensityFactor.toFixed(2).replace(".", ",")}
                    </div>
                  </div>
                </div>
                <span className="hidden items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white sm:inline-flex">
                  <Send className="size-3.5" /> An Gerät senden
                </span>
              </div>
              <div className="mt-4">
                <WorkoutChart structure={hero} thresholds={DEFAULT_THRESHOLDS} height={190} />
              </div>
              <div className="mt-3 rounded-xl bg-surface-2 px-3.5 py-3 font-mono text-[12px] leading-6 text-ink-2">
                {HERO_TEXT.split("\n").map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-5 left-6 hidden items-center gap-2.5 rounded-2xl border border-border bg-surface px-4 py-3 shadow-raised sm:flex">
              <span className="grid size-8 place-items-center rounded-full bg-good-soft text-good-ink">
                <Check className="size-4" />
              </span>
              <div>
                <div className="text-[13px] font-semibold">Gesendet an Garmin Connect</div>
                <div className="text-[12px] text-ink-3">Edge 1050 · morgen, 06:30</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border bg-bg">
        <div className="mx-auto max-w-[1160px] px-5 py-20 sm:px-8">
          <h2 className="max-w-2xl text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">Alles, was zwischen Idee und Einheit liegt.</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Type,
                title: "Schreiben statt klicken",
                text: "„5x (3min 110%, 2min 55%)“ reicht. Wrkhive versteht Minuten, Kilometer, Watt, Pace, Puls, Zonen und sogar GA1 bis SB. Der visuelle Editor bleibt immer synchron.",
              },
              {
                icon: Send,
                title: "Ein Klick aufs Gerät",
                text: "Direkt in den Garmin-Connect-Kalender oder auf dein Wahoo ELEMNT. Für alle anderen Geräte gibt es FIT- und Zwift-Dateien.",
              },
              {
                icon: MessageSquare,
                title: "KI-Coach",
                text: "Spontan 45 Minuten Zeit und müde Beine? Der Coach kennt deine Form und baut dir die passende Einheit oder einen kompletten Trainingsplan bis zum Wettkampf.",
              },
              {
                icon: CalendarDays,
                title: "Pläne, die sich anpassen",
                text: "Periodisierung mit Grundlage, Aufbau, Spitze und Tapering. Entlastungswochen inklusive. Geplante Einheiten werden automatisch abgehakt, wenn du sie absolviert hast.",
              },
              {
                icon: BarChart3,
                title: "Deine Form auf einen Blick",
                text: "Fitness, Ermüdung und Form (CTL, ATL, TSB), Wochenumfänge, Pulszonen, VO2max-Schätzung und Wettkampfprognosen aus deinen Aktivitäten.",
              },
              {
                icon: Check,
                title: "Kraft gehört dazu",
                text: "Sätze, Wiederholungen und Gewichte mit 50 Übungen, die Garmin-Uhren mit Animation und automatischer Wiederholungszählung anzeigen.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-[18px] border border-border bg-surface p-6 shadow-card">
                <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-ink">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-5 py-20 text-center sm:px-8">
        <h2 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">Dein nächstes Training ist 30 Sekunden entfernt.</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href={user ? "/workouts/new" : "/signup"} size="lg">
            {user ? "Neues Workout" : "Kostenlos starten"}
            <ArrowRight />
          </ButtonLink>
          {!user ? <DemoButton /> : null}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-3 px-5 py-8 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:px-8">
          <Logo className="opacity-80" />
          <p>Garmin, Wahoo und Zwift sind Marken ihrer jeweiligen Inhaber. Wrkhive ist ein unabhängiges Produkt.</p>
          <Link href="/login" className="hover:text-ink">
            Anmelden
          </Link>
        </div>
      </footer>
    </div>
  );
}
