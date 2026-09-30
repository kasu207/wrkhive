import type { FuelSport } from "@/lib/nutrition";

export interface RecentActivity {
  id: string;
  date: string;
  sport: FuelSport | "other";
  name: string;
  durationSec: number;
  logged: boolean;
}

export const SPORT_OPTIONS: { value: FuelSport; label: string }[] = [
  { value: "ride", label: "Rad" },
  { value: "run", label: "Laufen" },
  { value: "strength", label: "Kraft" },
];

export const num = (s: string) => Number(s.replace(",", ".")) || 0;
