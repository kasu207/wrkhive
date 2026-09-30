/**
 * Dashboard widgets. Every athlete assembles their own dashboard from this
 * catalog: which widgets, in which order, in which size. Widgets without
 * data show how to get it instead of an empty chart.
 */

export type WidgetSize = "s" | "m" | "l";

export type WidgetGroup = "today" | "recovery" | "load" | "performance" | "activities";

export const GROUP_LABEL: Record<WidgetGroup, string> = {
  today: "Heute",
  recovery: "Erholung und Gesundheit",
  load: "Belastung und Umfang",
  performance: "Leistung",
  activities: "Aktivitäten und Planung",
};

export const WIDGETS = {
  today: { title: "Heute", description: "Geplante Einheit, Anpassung an deine Form und die nächsten Tage.", group: "today", sizes: ["m", "l"] },
  fueling: { title: "Verpflegung", description: "Was du für die nächste Einheit einpackst, und Protokoll nach langen Einheiten.", group: "today", sizes: ["m"] },
  form: { title: "Form", description: "Frische relativ zu deiner Fitness, mit Fitness und Ermüdung.", group: "today", sizes: ["m", "l"] },
  recovery: { title: "Erholung", description: "HRV, Ruhepuls, Schlaf und Check-in zu einer Aussage verdichtet.", group: "recovery", sizes: ["m", "l"] },
  checkin: { title: "Morgen-Check-in", description: "Beine, Schlafgefühl und Motivation in drei Klicks, optional Messwerte.", group: "recovery", sizes: ["m", "l"] },
  restingHr: { title: "Ruhepuls", description: "7-Tage-Schnitt gegen deinen Normalbereich.", group: "recovery", sizes: ["s", "m"] },
  hrv: { title: "HRV", description: "Nächtliche Herzfrequenzvariabilität, 7-Tage-Schnitt gegen deinen Normalbereich.", group: "recovery", sizes: ["s", "m"] },
  sleep: { title: "Schlafdauer", description: "Geschlafene Zeit pro Nacht, ohne Schlaf-Score.", group: "recovery", sizes: ["s", "m"] },
  weight: { title: "Gewicht", description: "Verlauf für Watt pro Kilogramm.", group: "recovery", sizes: ["s", "m"] },
  weekHours: { title: "Diese Woche", description: "Trainingsstunden gegen die Vorwoche.", group: "load", sizes: ["s"] },
  weekLoad: { title: "Belastung Woche", description: "TSS dieser Woche gegen die Vorwoche.", group: "load", sizes: ["s"] },
  weekDistance: { title: "Distanz Woche", description: "Kilometer dieser Woche gegen die Vorwoche.", group: "load", sizes: ["s"] },
  count28: { title: "Aktivitäten", description: "Anzahl Einheiten der letzten 28 Tage.", group: "load", sizes: ["s"] },
  consistency: { title: "Regelmäßigkeit", description: "Wochen in Folge, in denen du dein Wochenziel erreicht hast.", group: "load", sizes: ["s", "m"] },
  pmc: { title: "Leistungsentwicklung", description: "Fitness, Ermüdung und Form über bis zu ein Jahr.", group: "load", sizes: ["l"] },
  volume: { title: "Wochenumfang", description: "Stunden pro Woche nach Sportart.", group: "load", sizes: ["m", "l"] },
  intensity: { title: "Intensitätsverteilung", description: "Anteil locker, mittel und hart der letzten 28 Tage, Ziel etwa 80/20.", group: "load", sizes: ["m", "l"] },
  zones: { title: "Pulszonen", description: "Zeit in den fünf Pulszonen der letzten 28 Tage.", group: "load", sizes: ["m", "l"] },
  thresholds: { title: "Schwellen-Check", description: "Prüft FTP, Maximal-, Schwellen- und Ruhepuls gegen deine Aufzeichnungen.", group: "performance", sizes: ["m", "l"] },
  efficiency: { title: "Aerobe Effizienz", description: "Leistung pro Herzschlag in lockeren Einheiten und aerobe Entkopplung.", group: "performance", sizes: ["m", "l"] },
  bests: { title: "Bestwerte", description: "Beste Leistung über 5 s bis 60 min und schnellste Laufzeiten, mit FTP-Schätzung.", group: "performance", sizes: ["m", "l"] },
  vo2max: { title: "VO2max", description: "Lauf aus Pace und Puls, Rad aus 5-min-Leistung pro kg, im Vergleich mit dem Wert deiner Uhr.", group: "performance", sizes: ["s", "m"] },
  predictions: { title: "Laufprognosen", description: "Zielzeiten für 5 km bis Marathon aus deiner VO2max.", group: "performance", sizes: ["m"] },
  recent: { title: "Letzte Aktivitäten", description: "Die sechs neuesten Einheiten.", group: "activities", sizes: ["m", "l"] },
  planned: { title: "Diese Woche geplant", description: "Geplante Workouts der nächsten sieben Tage.", group: "activities", sizes: ["m"] },
} satisfies Record<string, { title: string; description: string; group: WidgetGroup; sizes: WidgetSize[] }>;

export type WidgetId = keyof typeof WIDGETS;

export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export interface LayoutItem {
  id: WidgetId;
  size: WidgetSize;
  /** Consistency: sessions per week that count as a good week. */
  goal?: number;
}

/** Visible widgets in display order. */
export type DashboardLayout = LayoutItem[];

export const DEFAULT_GOAL = 3;

export const DEFAULT_LAYOUT: DashboardLayout = [
  { id: "today", size: "m" },
  { id: "form", size: "m" },
  { id: "recovery", size: "m" },
  { id: "checkin", size: "m" },
  { id: "fueling", size: "m" },
  { id: "restingHr", size: "s" },
  { id: "hrv", size: "s" },
  { id: "weekHours", size: "s" },
  { id: "weekLoad", size: "s" },
  { id: "consistency", size: "s", goal: DEFAULT_GOAL },
  { id: "vo2max", size: "s" },
  { id: "thresholds", size: "m" },
  { id: "intensity", size: "m" },
  { id: "pmc", size: "l" },
  { id: "efficiency", size: "m" },
  { id: "bests", size: "m" },
  { id: "volume", size: "m" },
  { id: "recent", size: "m" },
  { id: "predictions", size: "m" },
];

/** Drops unknown widgets and duplicates, fixes sizes a widget does not support. */
export function sanitizeLayout(input: unknown): DashboardLayout {
  if (!Array.isArray(input)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const out: DashboardLayout = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { id, size, goal } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !(id in WIDGETS) || seen.has(id)) continue;
    seen.add(id);
    const sizes: readonly WidgetSize[] = WIDGETS[id as WidgetId].sizes;
    const item: LayoutItem = { id: id as WidgetId, size: sizes.includes(size as WidgetSize) ? (size as WidgetSize) : sizes[0] };
    if (id === "consistency") item.goal = typeof goal === "number" && Number.isInteger(goal) && goal >= 1 && goal <= 14 ? goal : DEFAULT_GOAL;
    out.push(item);
  }
  return out;
}

export function layoutOf(stored: DashboardLayout | null | undefined): DashboardLayout {
  return stored ? sanitizeLayout(stored) : DEFAULT_LAYOUT;
}
