/**
 * Catalog of the devices and training apps athletes use, how data flows
 * between each of them and Wrkhive, and attribution of synced activities to
 * the app they were recorded with.
 *
 * Routes (verified against the vendors' published integrations):
 *  - Garmin, Wahoo: direct API or via intervals.icu (both directions)
 *  - Zwift: intervals.icu uploads planned workouts through Zwift's Training
 *    API and receives finished rides; .zwo files for the Zwift workouts folder
 *  - MyWhoosh: intervals.icu syncs planned workouts to MyWhoosh, rides are
 *    uploaded to intervals.icu (MyWhoosh has no local workout folder)
 *  - ROUVY: intervals.icu sends planned workouts as "workout of the day",
 *    ROUVY rides sync to intervals.icu; .zwo upload in the ROUVY web portal
 *  - Freeletics: no public interface; workouts are written to Apple Health /
 *    Health Connect only, from where a companion app uploads them to
 *    intervals.icu
 */

export const SOURCE_APPS = ["garmin", "wahoo", "zwift", "mywhoosh", "rouvy", "freeletics", "apple", "coros", "polar", "suunto", "strava", "file", "demo"] as const;
export type SourceAppId = (typeof SOURCE_APPS)[number];

export const SOURCE_APP_LABEL: Record<SourceAppId, string> = {
  garmin: "Garmin",
  wahoo: "Wahoo",
  zwift: "Zwift",
  mywhoosh: "MyWhoosh",
  rouvy: "ROUVY",
  freeletics: "Freeletics",
  apple: "Apple Health",
  coros: "COROS",
  polar: "Polar",
  suunto: "Suunto",
  strava: "Strava",
  file: "Datei",
  demo: "Demo",
};

/** Training apps (virtual rides, app workouts) take precedence over the recording device. */
const TRAINING_APPS: SourceAppId[] = ["zwift", "mywhoosh", "rouvy", "freeletics"];
export const isTrainingApp = (a: SourceAppId | null | undefined) => !!a && TRAINING_APPS.includes(a);

const PATTERNS: [SourceAppId, RegExp][] = [
  ["zwift", /\bzwift\b/i],
  ["mywhoosh", /\bmy\s?whoosh\b|\bwhoosh\b/i],
  ["rouvy", /\brouvy\b/i],
  ["freeletics", /\bfreeletics\b/i],
  ["wahoo", /\bwahoo\b|\belemnt\b|\bkickr\b|\brival\b/i],
  ["garmin", /\bgarmin\b|\bforerunner\b|\bf[eē]nix\b|\bedge\s?\d|\bvenu\b|\bepix\b|\benduro\b|\binstinct\b|\bvivoactive\b/i],
  ["coros", /\bcoros\b/i],
  ["polar", /\bpolar\b/i],
  ["suunto", /\bsuunto\b/i],
  ["apple", /\bapple\b|\bhealthkit\b|\bhealth\s?connect\b|\bcompanion\b/i],
  ["strava", /\bstrava\b/i],
];

/**
 * Attributes an activity to the app or device it came from. Hints are
 * checked in order (most specific first), e.g. [device name, uploading
 * client, source]. The activity name is only consulted for training apps,
 * because users freely name their activities.
 */
export function detectSourceApp(input: { hints?: (string | null | undefined)[]; name?: string | null; fallback?: SourceAppId | null }): SourceAppId | null {
  const text = (input.hints ?? []).filter(Boolean).join(" ");
  for (const [id, re] of PATTERNS) if (text && re.test(text)) return id;
  if (input.name) for (const [id, re] of PATTERNS) if (isTrainingApp(id) && re.test(input.name)) return id;
  return input.fallback ?? null;
}

export type FlowStatus = "ready" | "setup" | "unsupported";

export interface AppRoute {
  /** Wrkhive connection the route depends on, if any. */
  via: "intervals" | "garmin" | "wahoo" | "file" | "none";
  text: string;
}

export interface AppInfo {
  id: "garmin" | "wahoo" | "zwift" | "mywhoosh" | "rouvy" | "freeletics";
  name: string;
  kind: "device" | "app";
  tagline: string;
  /** How finished activities reach Wrkhive, best route first. */
  activities: AppRoute[];
  /** How Wrkhive workouts reach the app or device, best route first. */
  workouts: AppRoute[];
  /** One-time setup, shown as numbered steps. */
  setup: string[];
  link: { label: string; href: string } | null;
}

export const APPS: AppInfo[] = [
  {
    id: "garmin",
    name: "Garmin",
    kind: "device",
    tagline: "Uhren und Edge-Radcomputer",
    activities: [
      { via: "garmin", text: "Direkt über die Garmin-API" },
      { via: "intervals", text: "Über intervals.icu" },
      { via: "file", text: "FIT-Datei importieren" },
    ],
    workouts: [
      { via: "garmin", text: "Direkt in den Garmin-Connect-Kalender" },
      { via: "intervals", text: "Über intervals.icu in den Garmin-Connect-Kalender" },
      { via: "file", text: "FIT-Datei per USB nach GARMIN/NewFiles" },
    ],
    setup: [
      "Direkt: nur mit Zugang zum Garmin Connect Developer Program (Freigabe durch Garmin, siehe Anleitung).",
      "Ohne Freigabe: in intervals.icu unter Settings Garmin Connect verbinden, dort „Upload planned workouts“ aktivieren und intervals.icu hier verbinden.",
      "Ganz ohne Konto: Workout als FIT-Datei per USB in den Ordner GARMIN/NewFiles kopieren.",
    ],
    link: { label: "intervals.icu Settings", href: "https://intervals.icu/settings" },
  },
  {
    id: "wahoo",
    name: "Wahoo",
    kind: "device",
    tagline: "ELEMNT-Radcomputer und KICKR",
    activities: [
      { via: "wahoo", text: "Direkt über die Wahoo-API" },
      { via: "intervals", text: "Über intervals.icu" },
      { via: "file", text: "FIT-Datei aus der ELEMNT-App teilen und importieren" },
    ],
    workouts: [
      { via: "wahoo", text: "Direkt als geplantes Workout auf den ELEMNT" },
      { via: "intervals", text: "Über intervals.icu auf den ELEMNT (nächste 7 Tage)" },
    ],
    setup: [
      "Direkt (empfohlen): unten in der Wahoo-Karte verbinden. Ist für diese Installation noch keine Wahoo-App hinterlegt, legst du dort einmalig eine kostenlose persönliche App an (Wahoo prüft neue Apps, das dauert einige Tage; bis dahin geht es über intervals.icu).",
      "Danach auf dem ELEMNT unter „Geplante Workouts“ starten; ein gekoppelter Smart-Trainer wird im ERG-Modus gesteuert.",
    ],
    link: { label: "Wahoo-Entwicklerportal", href: "https://developers.wahooligan.com/" },
  },
  {
    id: "zwift",
    name: "Zwift",
    kind: "app",
    tagline: "Virtuelles Radfahren und Laufen",
    activities: [
      { via: "intervals", text: "Über intervals.icu (offizielle Zwift-Anbindung)" },
      { via: "file", text: "FIT-Datei aus Zwift importieren" },
    ],
    workouts: [
      { via: "intervals", text: "Über intervals.icu in den Zwift-Trainingskalender" },
      { via: "file", text: "ZWO-Datei in den Ordner Dokumente/Zwift/Workouts/<ID> legen" },
    ],
    setup: ["In intervals.icu unter Settings Zwift verbinden.", "Geplante Workouts erscheinen in Zwift unter Training."],
    link: { label: "intervals.icu Settings", href: "https://intervals.icu/settings" },
  },
  {
    id: "mywhoosh",
    name: "MyWhoosh",
    kind: "app",
    tagline: "Kostenloses Indoor-Training",
    activities: [
      { via: "intervals", text: "Über intervals.icu (offizielle MyWhoosh-Anbindung)" },
      { via: "file", text: "FIT-Datei auf mywhoosh.com unter Profil > Activity Files herunterladen und importieren" },
    ],
    workouts: [{ via: "intervals", text: "Über intervals.icu in den MyWhoosh-Kalender" }],
    setup: ["In der MyWhoosh-App unter Connections intervals.icu verbinden.", "Geplante Workouts erscheinen in MyWhoosh, Fahrten landen automatisch in intervals.icu."],
    link: null,
  },
  {
    id: "rouvy",
    name: "ROUVY",
    kind: "app",
    tagline: "Echte Strecken als Video",
    activities: [{ via: "intervals", text: "Über intervals.icu (offizielle ROUVY-Anbindung)" }],
    workouts: [
      { via: "intervals", text: "Über intervals.icu als „Workout of the day“" },
      { via: "file", text: "ZWO-Datei im ROUVY-Webportal unter eigene Workouts hochladen" },
    ],
    setup: ["In ROUVY unter Connected apps intervals.icu verbinden.", "Synchronisierung auf „automatisch“ stellen."],
    link: { label: "ROUVY Integrationen", href: "https://rouvy.com/integrations" },
  },
  {
    id: "freeletics",
    name: "Freeletics",
    kind: "app",
    tagline: "Bodyweight- und Krafttraining",
    activities: [{ via: "intervals", text: "Über Apple Health bzw. Health Connect und eine Sync-App nach intervals.icu" }],
    workouts: [],
    setup: [
      "In Freeletics unter Profil > Einstellungen die Übertragung an Apple Health (iPhone) bzw. Health Connect (Android) aktivieren.",
      "iPhone: die App „Intervals.icu Companion“ installieren und Workouts aus Apple Health an intervals.icu senden lassen. Android: „Health Sync“ mit Ziel intervals.icu.",
    ],
    link: null,
  },
];

/** Freeletics offers no interface to receive workouts; its training plans stay in the app. */
export const WORKOUT_UNSUPPORTED_NOTE: Partial<Record<AppInfo["id"], string>> = {
  freeletics: "Freeletics nimmt keine fremden Workouts an. Deine Einheiten zählen trotzdem in Belastung und Kalender.",
};

export type ConnectionId = "garmin" | "wahoo" | "intervals";

export interface Recommendation {
  /** Connections to set up, most important first, with the apps each one covers. */
  connections: { id: ConnectionId; apps: AppInfo["id"][] }[];
  /** Per app: the route used for activities and for workouts (null = not possible). */
  routes: { app: AppInfo; activities: AppRoute | null; workouts: AppRoute | null }[];
}

/**
 * The smallest set of connections that covers the selected apps. Direct
 * Garmin/Wahoo connections are only suggested when this installation has
 * API credentials for them; intervals.icu works everywhere.
 */
export function recommendConnections(selected: AppInfo["id"][], directAvailable: { garmin: boolean; wahoo: boolean }): Recommendation {
  const usable = (r: AppRoute) => r.via === "intervals" || r.via === "file" || (r.via === "garmin" && directAvailable.garmin) || (r.via === "wahoo" && directAvailable.wahoo);
  const pick = (list: AppRoute[]) => list.find((r) => usable(r) && r.via !== "file") ?? list.find(usable) ?? null;
  const routes = APPS.filter((a) => selected.includes(a.id)).map((app) => ({ app, activities: pick(app.activities), workouts: pick(app.workouts) }));
  const byConn = new Map<ConnectionId, Set<AppInfo["id"]>>();
  for (const r of routes) {
    for (const route of [r.activities, r.workouts]) {
      if (!route || route.via === "file" || route.via === "none") continue;
      const set = byConn.get(route.via) ?? new Set();
      set.add(r.app.id);
      byConn.set(route.via, set);
    }
  }
  const connections = [...byConn.entries()].map(([id, apps]) => ({ id, apps: [...apps] })).sort((a, b) => b.apps.length - a.apps.length);
  return { connections, routes };
}

/** Order of connections for the send dialog: the athlete's own devices first. */
export function connectionPreference(apps: readonly string[] | null | undefined): ConnectionId[] {
  const list = apps ?? [];
  const order: ConnectionId[] = [];
  if (list.includes("wahoo")) order.push("wahoo");
  if (list.includes("garmin")) order.push("garmin");
  if (list.some((a) => a === "zwift" || a === "mywhoosh" || a === "rouvy")) order.push("intervals");
  for (const c of ["wahoo", "garmin", "intervals"] as const) if (!order.includes(c)) order.push(c);
  return order;
}
