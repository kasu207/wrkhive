import type { Sport } from "./types";

export type TemplateCategory = "recovery" | "endurance" | "tempo" | "threshold" | "vo2" | "anaerobic" | "test" | "strength";

export interface WorkoutTemplate {
  id: string;
  sport: Sport;
  category: TemplateCategory;
  name: string;
  description: string;
  /** Workout in text notation, see text.ts. */
  text: string;
}

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  recovery: "Regeneration",
  endurance: "Grundlage",
  tempo: "Tempo",
  threshold: "Schwelle",
  vo2: "VO2max",
  anaerobic: "Anaerob",
  test: "Leistungstest",
  strength: "Kraft",
};

export const TEMPLATES: WorkoutTemplate[] = [
  // --- Rad -----------------------------------------------------------------
  {
    id: "ride-recovery-45",
    sport: "ride",
    category: "recovery",
    name: "Aktive Erholung",
    description: "Lockeres Rollen mit hoher Trittfrequenz. Fördert die Regeneration nach harten Tagen.",
    text: "Aufwärmen 5min 45-50%\n35min 50-55% 90-95rpm\nCool-down 5min 45%",
  },
  {
    id: "ride-endurance-90",
    sport: "ride",
    category: "endurance",
    name: "Grundlage 90",
    description: "Ruhige Grundlagenfahrt in Zone 2. Baut aerobe Kapazität und Fettstoffwechsel auf.",
    text: "Aufwärmen 10min 50-60%\n70min 65-75% 85-95rpm\nCool-down 10min 50%",
  },
  {
    id: "ride-tempo-3x15",
    sport: "ride",
    category: "tempo",
    name: "Tempo 3x15",
    description: "Drei längere Blöcke im Tempobereich. Steigert die muskuläre Ausdauer.",
    text: "Aufwärmen 12min 50-65%\n3x (15min 80-88%, Erholung 5min 55%)\nCool-down 8min 50%",
  },
  {
    id: "ride-sweetspot-2x20",
    sport: "ride",
    category: "threshold",
    name: "Sweet Spot 2x20",
    description: "Der Klassiker: zwei 20-Minuten-Blöcke knapp unter der Schwelle für maximale FTP-Wirkung pro Stunde.",
    text: "Aufwärmen 10min 50-65%\n3x (1min 100%, Erholung 1min 50%)\n2x (20min 88-94%, Erholung 5min 55%)\nCool-down 8min 50%",
  },
  {
    id: "ride-threshold-3x12",
    sport: "ride",
    category: "threshold",
    name: "Schwelle 3x12",
    description: "Intervalle an der funktionellen Schwelle. Hebt die FTP direkt an.",
    text: "Aufwärmen 15min 50-70%\n3x (12min 95-100%, Erholung 6min 55%)\nCool-down 10min 50%",
  },
  {
    id: "ride-overunder",
    sport: "ride",
    category: "threshold",
    name: "Over-Unders 4x8",
    description: "Wechsel knapp über und unter der Schwelle. Trainiert Laktattoleranz und Tempohärte.",
    text: "Aufwärmen 15min 50-70%\n4x (2min 95%, 1min 110%, 2min 95%, 1min 110%, 2min 95%, Erholung 4min 50%)\nCool-down 10min 50%",
  },
  {
    id: "ride-vo2-5x4",
    sport: "ride",
    category: "vo2",
    name: "VO2max 5x4",
    description: "Fünf harte Vier-Minuten-Intervalle. Erhöht die maximale Sauerstoffaufnahme.",
    text: "Aufwärmen 15min 50-70%\n5x (4min 110-118%, Erholung 4min 50%)\nCool-down 10min 50%",
  },
  {
    id: "ride-3030",
    sport: "ride",
    category: "vo2",
    name: "30/30 Intervalle",
    description: "Kurze Wechsel aus 30 Sekunden hart und 30 Sekunden locker. Viel Zeit nahe VO2max.",
    text: "Aufwärmen 15min 50-70%\n10x (30s 120-130%, 30s 50%)\nErholung 5min 50%\n10x (30s 120-130%, 30s 50%)\nCool-down 10min 50%",
  },
  {
    id: "ride-sprints",
    sport: "ride",
    category: "anaerobic",
    name: "Sprints 8x15s",
    description: "Maximale Sprints mit vollständiger Erholung. Neuromuskuläre Kraft und Antritt.",
    text: "Aufwärmen 15min 50-70%\n8x (15s 200% 110-120rpm, Erholung 4min 45s 50%)\nCool-down 10min 50%",
  },
  {
    id: "ride-ftp-ramp",
    sport: "ride",
    category: "test",
    name: "FTP-Test 20 min",
    description: "Klassischer 20-Minuten-Test. FTP ≈ 95 % der Durchschnittsleistung im Testblock.",
    text: "Aufwärmen 20min 50-70%\n3x (1min 110%, Erholung 1min 50%)\n5min 50%\n5min 105-115%\n10min 50%\n\"Test: gleichmäßig maximal\" 20min 100-110%\nCool-down 10min 45%",
  },
  // --- Laufen --------------------------------------------------------------
  {
    id: "run-easy-45",
    sport: "run",
    category: "recovery",
    name: "Lockerer Dauerlauf",
    description: "Entspanntes Laufen im Gesprächstempo. Das Fundament jeder Laufwoche.",
    text: "45min Z2",
  },
  {
    id: "run-long-90",
    sport: "run",
    category: "endurance",
    name: "Langer Lauf",
    description: "Ruhiger langer Lauf mit zügigem Schlussteil. Aerobe Ausdauer und Ermüdungsresistenz.",
    text: "Aufwärmen 10min Z1\n65min Z2\n\"Endbeschleunigung\" 10min Z3\nCool-down 5min Z1",
  },
  {
    id: "run-tempo-3x10",
    sport: "run",
    category: "tempo",
    name: "Tempodauerlauf 3x10",
    description: "Drei Blöcke im Bereich der Halbmarathonpace.",
    text: "Aufwärmen 15min Z1-Z2\n3x (10min Z3, Erholung 3min Z1)\nCool-down 10min Z1",
  },
  {
    id: "run-threshold-4x1600",
    sport: "run",
    category: "threshold",
    name: "Schwelle 4x1600 m",
    description: "Kilometerlange Wiederholungen an der Laktatschwelle.",
    text: "Aufwärmen 2km Z2\n4x (1.6km Z4, Pause 2min)\nCool-down 2km Z1",
  },
  {
    id: "run-vo2-6x800",
    sport: "run",
    category: "vo2",
    name: "Intervalle 6x800 m",
    description: "Klassische Bahnintervalle im 5-km-Renntempo.",
    text: "Aufwärmen 2km Z2\n6x (800m Z5, Pause 2min)\nCool-down 1.5km Z1",
  },
  {
    id: "run-hills",
    sport: "run",
    category: "anaerobic",
    name: "Bergsprints 10x30s",
    description: "Kurze, kraftvolle Bergauf-Sprints mit lockerem Zurücktraben.",
    text: "Aufwärmen 15min Z1-Z2\n10x (\"Bergauf\" 30s RPE 9, Erholung 90s RPE 2)\nCool-down 10min Z1",
  },
  {
    id: "run-5k-test",
    sport: "run",
    category: "test",
    name: "5-km-Test",
    description: "Maximaler 5-km-Lauf zur Bestimmung von Schwellenpace und VO2max.",
    text: "Aufwärmen 15min Z1-Z2\n4x (20s Z6, Erholung 40s Z1)\n\"5 km maximal\" 5km Z5\nCool-down 10min Z1",
  },
  // --- Kraft ---------------------------------------------------------------
  {
    id: "strength-legs",
    sport: "strength",
    category: "strength",
    name: "Beine & Rumpf",
    description: "Kraftgrundlage für Rad und Lauf: Kniebeuge, Kreuzheben, einbeiniges Training und Core.",
    text: "Aufwärmen 8min RPE 3\n4x6 Kniebeuge (Langhantel) 60kg Pause 2min\n3x8 Rumänisches Kreuzheben 50kg Pause 2min\n3x10 Split Squat (Kurzhantel) 12kg Pause 90s\n3x12 Wadenheben 20kg Pause 60s\n3x (45s Unterarmstütz, Pause 30s)",
  },
  {
    id: "strength-upper",
    sport: "strength",
    category: "strength",
    name: "Oberkörper & Core",
    description: "Ausgewogenes Push/Pull-Training für Haltung und Stabilität.",
    text: "Aufwärmen 5min RPE 3\n4x8 Bankdrücken (Kurzhantel) 20kg Pause 2min\n4x8 Rudern (Kurzhantel) 22kg Pause 2min\n3x10 Schulterdrücken (Kurzhantel) 12kg Pause 90s\n3x8 Klimmzug Pause 2min\n3x12 Dead Bug Pause 45s",
  },
  {
    id: "strength-full",
    sport: "strength",
    category: "strength",
    name: "Ganzkörper Kraft",
    description: "Effizientes Ganzkörpertraining in 45 Minuten.",
    text: "Aufwärmen 5min RPE 3\n3x8 Goblet Squat 20kg Pause 90s\n3x10 Hip Thrust 60kg Pause 90s\n3x10 Liegestütz Pause 60s\n3x10 Latzug 45kg Pause 90s\n3x15 Kettlebell Swing 16kg Pause 60s\n3x (40s Seitstütz, Pause 20s)",
  },
  {
    id: "strength-plyo",
    sport: "strength",
    category: "strength",
    name: "Athletik & Sprungkraft",
    description: "Reaktivkraft für Läufer: Sprünge, einbeinige Stabilität und Rumpf.",
    text: "Aufwärmen 8min RPE 3\n4x5 Box Jump Pause 90s\n3x8 Sprungkniebeuge Pause 90s\n3x8 Einbeiniges Kreuzheben 10kg Pause 60s\n3x10 Step-up 10kg Pause 60s\n3x12 Mountain Climber Pause 45s",
  },
];

export function templatesFor(sport?: Sport) {
  return sport ? TEMPLATES.filter((t) => t.sport === sport) : TEMPLATES;
}
