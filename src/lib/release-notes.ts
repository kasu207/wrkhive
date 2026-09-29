/**
 * What changed in Wrkhive, newest first. Shown on /release-notes, linked
 * quietly from the sidebar and the settings page.
 */
export interface Release {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.4",
    date: "2026-09-29",
    title: "Termine, Ziele und Neuigkeiten",
    items: [
      "Kalender: Termine ohne Workout planen, etwa Jiu-Jitsu oder Krafttraining im Studio, einmalig oder wöchentlich.",
      "Nach dem Termin fragt Wrkhive, ob er stattgefunden hat: bestätigen und mit Dauer und Anstrengung bewerten. Zeichnet deine Uhr die Einheit auf, wird der Termin automatisch erledigt und ein manueller Eintrag ersetzt.",
      "Offene Termine erscheinen auf der Übersicht, im Kalender und als Zähler im Menü.",
      "Einstellungen: bis zu drei Trainingsziele wählen (Muskelaufbau, Ausdauer, Wettkampf, Gewicht, Gesundheit). Das Hauptziel steuert Schwerpunkt und Länge vorgeschlagener Workouts, Krafttraining und Intensität neuer Pläne.",
      "Der Coach kennt deine Ziele und festen Termine.",
      "Diese Seite mit den Neuigkeiten.",
    ],
  },
  {
    version: "0.3",
    date: "2026-09-29",
    title: "Workouts automatisch erzeugen, VO2max",
    items: [
      "Neues Workout: direkt im Editor automatisch erzeugen lassen, mit Schwerpunkt, Dauer und optionalem Wunsch.",
      "VO2max für das Rad aus der besten 5-Minuten-Leistung und dem Gewicht.",
      "VO2max deiner Uhr aus Garmin, Apple Health und intervals.icu im Vergleich mit den Wrkhive-Werten.",
    ],
  },
  {
    version: "0.2",
    date: "2026-09-29",
    title: "Gesundheitswerte und eigenes Dashboard",
    items: [
      "Einheiten ohne Uhr über Session-RPE nachtragen, auch für vergangene Tage.",
      "Apple Health: Import des Exports und laufende Übertragung mit Health Auto Export.",
      "Ruhepuls, HRV, Schlaf und Gewicht mit Morgen-Check-in; eingeschränkte Erholung macht harte Einheiten leichter.",
      "Dashboard frei zusammenstellen: Widgets wählen, sortieren und in der Größe anpassen.",
      "Kurze Trainingshistorien werden nicht mehr als Überlastung gewertet.",
    ],
  },
  {
    version: "0.1",
    date: "2026-09-27",
    title: "Erste Version",
    items: [
      "Workout-Builder für Rad, Laufen und Krafttraining, visuell oder als Text.",
      "Senden an Garmin, Wahoo und intervals.icu, inklusive ERG-Modus für Smart-Trainer.",
      "Kalender mit Drag & Drop und automatischem Abhaken, Trainingspläne vom Coach.",
      "Aktivitäten-Sync, Belastung, Fitness und Form, Anpassung an die Tagesform.",
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;
