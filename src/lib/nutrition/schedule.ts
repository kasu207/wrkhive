import { formatNumber } from "@/lib/format";
import { SINGLE_SOURCE_LIMIT } from "./guidelines";
import type { DuringTargets, FuelProduct, FuelProfile, FuelSchedule, PackingItem, ScheduleSlot, SessionInput } from "./types";

/** Minutes a slot may move to avoid eating inside a hard interval. */
const SHIFT_WINDOW = 5;
/** No intake in the last minutes: it would not arrive in time. */
const END_BUFFER = 15;
const MAX_PIECES = 3;
/** Share of the carbohydrate that may come from the bottle; the rest keeps variety and backup. Runners carry little fluid. */
const DRINK_SHARE = { ride: 0.6, run: 0.35, strength: 0.6 } as const;

const SOLID = new Set(["bar", "fruit", "snack"]);
const QUICK = new Set(["gel", "chew"]);

function intervalMinutes(input: SessionInput, during: DuringTargets): number {
  if (input.sport === "strength") return 30;
  if (input.sport === "run" && during.carbsPerHour <= 45) return 30;
  return 20;
}

/** Zone of the workout at a minute, or null without a structure. */
function segmentAt(input: SessionInput, minute: number) {
  const sec = minute * 60;
  return input.segments?.find((s) => sec >= s.start && sec < s.start + s.duration) ?? null;
}

function isHard(input: SessionInput, minute: number) {
  const s = segmentAt(input, minute);
  return !!s && s.zone >= 4 && s.kind !== "recovery" && s.kind !== "rest";
}

/** Moves a slot out of a hard interval into the nearest easier minute within the window. */
function align(input: SessionInput, minute: number, maxMinute: number): { at: number; shifted: boolean } {
  if (!input.segments?.length || !isHard(input, minute)) return { at: minute, shifted: false };
  for (let d = 1; d <= SHIFT_WINDOW; d++) {
    for (const c of [minute - d, minute + d]) {
      if (c >= 5 && c <= maxMinute && !isHard(input, c)) return { at: c, shifted: true };
    }
  }
  return { at: minute, shifted: false };
}

function slotTimes(input: SessionInput, during: DuringTargets): { at: number; shifted: boolean; hard: boolean }[] {
  const total = input.durationSec / 60;
  const step = intervalMinutes(input, during);
  const last = total - END_BUFFER;
  const raw: number[] = [];
  for (let t = step; t <= last; t += step) raw.push(t);
  if (!raw.length && total >= 30) raw.push(Math.round(total / 2));
  const out: { at: number; shifted: boolean; hard: boolean }[] = [];
  for (const t of raw) {
    const a = align(input, t, Math.max(t, last));
    // Keep slots ordered and at least 5 min apart after shifting.
    if (out.length && a.at - out[out.length - 1].at < 5) continue;
    out.push({ ...a, hard: isHard(input, a.at) });
  }
  return out;
}

function pickDrink(pantry: FuelProduct[], carbsPerHour: number): FuelProduct | null {
  const drinks = pantry.filter((p) => p.kind === "drink" && p.fluidMl && p.carbsG > 0 && p.caffeineMg === 0);
  if (!drinks.length) return null;
  const density = (p: FuelProduct) => p.carbsG / (p.fluidMl ?? 1);
  drinks.sort((a, b) => (carbsPerHour >= 75 ? density(b) - density(a) : density(a) - density(b)));
  return drinks[0];
}

/**
 * Turns the hourly targets into a concrete timeline: which product at which
 * minute, drawn from the athlete's pantry. Drinks cover part of the
 * carbohydrate, food fills the rest, salt tops up sodium. Slots avoid hard
 * intervals when the workout structure is known.
 */
export function buildSchedule(input: SessionInput, during: DuringTargets, pantry: FuelProduct[], profile: FuelProfile): FuelSchedule {
  const minutes = input.durationSec / 60;
  const hours = minutes / 60;
  const warnings: string[] = [];
  const empty: FuelSchedule = { slots: [], totals: { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0, carbsPerHour: 0 }, packing: [], waterMl: 0, warnings };
  if (during.carbsPerHour === 0 && during.fluidMlPerHour === 0) return empty;

  const times = slotTimes(input, during);
  if (!times.length) return empty;
  const n = times.length;

  const carbTotal = during.carbsPerHour * hours;
  const fluidTotal = during.fluidMlPerHour * hours;
  const sodiumTotal = during.sodiumMgPerHour * hours;
  let caffeineLeft = during.caffeineMg;

  // Bottles first.
  const drink = carbTotal > 0 && fluidTotal > 0 ? pickDrink(pantry, during.carbsPerHour) : null;
  let servings = 0;
  if (drink) {
    const byFluid = Math.floor(fluidTotal / drink.fluidMl! + 0.25);
    const byCarbs = Math.floor((carbTotal * DRINK_SHARE[input.sport]) / drink.carbsG + 0.25);
    servings = Math.max(0, Math.min(byFluid, byCarbs));
  }
  const drinkCarbs = drink ? servings * drink.carbsG : 0;
  const drinkSodium = drink ? servings * drink.sodiumMg : 0;

  const slots: ScheduleSlot[] = times.map((t) => ({
    atMin: t.at,
    items: [],
    carbsG: drinkCarbs / n,
    fluidMl: fluidTotal / n,
    sodiumMg: drinkSodium / n,
    caffeineMg: 0,
    note: t.shifted ? "Aus dem Intervall in die Erholung verschoben" : t.hard ? "Im Intervall: nur trinken oder Gel" : undefined,
  }));

  // Food fills the remaining carbohydrate.
  const food = pantry.filter((p) => p.kind !== "drink" && p.kind !== "salt" && p.carbsG > 0);
  const foodTotal = Math.max(0, carbTotal - drinkCarbs);
  const needMulti = during.carbsPerHour > SINGLE_SOURCE_LIMIT;
  if (foodTotal > 0 && !food.length && !drinkCarbs) warnings.push("Dein Vorrat enthält keine Kohlenhydrat-Produkte. Aktiviere unter „Vorrat“ z. B. Gels oder Datteln.");

  let consumed = 0;
  let previous: string | null = null;
  slots.forEach((slot, i) => {
    const late = slot.atMin / minutes > 0.6;
    const hard = times[i].hard;
    const score = (p: FuelProduct, deficit: number) => {
      let s = -Math.abs(deficit - p.carbsG) / 25;
      const solid = SOLID.has(p.kind);
      const quick = QUICK.has(p.kind);
      if (input.sport === "ride") {
        if (solid && !late && !hard) s += 1;
        if (quick && (late || hard)) s += 1;
      } else {
        if (quick) s += 1.5;
        if (solid && !(profile.preferNatural && p.kind === "fruit")) s -= 1.5;
        if (p.kind === "bar") s -= 2;
      }
      if (hard && solid) s -= 2;
      if (profile.preferNatural) {
        if (p.kind === "fruit" || p.kind === "snack") s += 1.5;
        if (p.kind === "gel") s -= 0.5;
      }
      if (needMulti) s += p.multiSource ? 1 : -1;
      if (p.caffeineMg > 0) s += 2;
      if (sodiumTotal > 0) s += p.sodiumMg / 500;
      if (p.id === previous) s -= 0.7;
      return s;
    };
    let pieces = 0;
    while (pieces < MAX_PIECES) {
      const deficit = (foodTotal * (i + 1)) / n - consumed;
      const options = food.filter((p) => {
        if (p.carbsG * 0.6 > deficit) return false;
        if (p.caffeineMg > 0) return caffeineLeft >= p.caffeineMg && slot.atMin >= minutes / 2;
        return true;
      });
      if (!options.length) break;
      const best = options.reduce((a, b) => (score(b, deficit) > score(a, deficit) ? b : a));
      const existing = slot.items.find((it) => it.productId === best.id);
      if (existing) existing.count++;
      else slot.items.push({ productId: best.id, name: best.name, count: 1 });
      slot.carbsG += best.carbsG;
      slot.sodiumMg += best.sodiumMg;
      slot.caffeineMg += best.caffeineMg;
      caffeineLeft -= best.caffeineMg;
      consumed += best.carbsG;
      pieces++;
    }
    if (slot.items.length) previous = slot.items[0].productId;
  });

  // Salt tops up sodium.
  const sodiumSoFar = slots.reduce((s, x) => s + x.sodiumMg, 0);
  const sodiumGap = sodiumTotal - sodiumSoFar;
  const salt = pantry.filter((p) => p.kind === "salt" && p.sodiumMg > 0).sort((a, b) => b.sodiumMg - a.sodiumMg)[0];
  if (sodiumGap >= 150 && salt) {
    const count = Math.max(1, Math.round(sodiumGap / salt.sodiumMg));
    for (let k = 0; k < count; k++) {
      const slot = slots[Math.min(n - 1, Math.floor(((k + 0.5) * n) / count))];
      const existing = slot.items.find((it) => it.productId === salt.id);
      if (existing) existing.count++;
      else slot.items.push({ productId: salt.id, name: salt.name, count: 1 });
      slot.sodiumMg += salt.sodiumMg;
    }
  } else if (sodiumGap >= 300) {
    warnings.push(`Es fehlen etwa ${Math.round(sodiumGap / 50) * 50} mg Natrium. Pack Salztabletten, Elektrolytgetränk oder Salzstangen ein.`);
  }

  for (const s of slots) {
    s.carbsG = Math.round(s.carbsG);
    s.fluidMl = Math.round(s.fluidMl / 50) * 50;
    s.sodiumMg = Math.round(s.sodiumMg);
  }

  const totals = {
    carbsG: Math.round(slots.reduce((s, x) => s + x.carbsG, 0)),
    fluidMl: Math.round(fluidTotal / 50) * 50,
    sodiumMg: Math.round(slots.reduce((s, x) => s + x.sodiumMg, 0)),
    caffeineMg: slots.reduce((s, x) => s + x.caffeineMg, 0),
    carbsPerHour: hours > 0 ? Math.round(slots.reduce((s, x) => s + x.carbsG, 0) / hours) : 0,
  };

  if (during.carbsPerHour > 0 && totals.carbsPerHour < during.carbsPerHour * 0.85 && (food.length || drinkCarbs)) {
    warnings.push(`Mit deinem Vorrat kommst du auf ${totals.carbsPerHour} statt ${during.carbsPerHour} g/h. Aktiviere weitere Produkte oder nimm einen Getränkemix mit.`);
  }
  if (needMulti) {
    const multi = drink && drink.multiSource ? drinkCarbs : 0;
    const multiFood = slots
      .flatMap((s) => s.items)
      .reduce((sum, it) => {
        const p = pantry.find((x) => x.id === it.productId);
        return sum + (p?.multiSource ? p.carbsG * it.count : 0);
      }, 0);
    if ((multi + multiFood) / Math.max(1, totals.carbsG) < 0.5) {
      warnings.push(`Über ${SINGLE_SOURCE_LIMIT} g/h brauchst du Produkte mit Glukose und Fruktose (z. B. Gel 2:1, Datteln, Getränkemix). Reine Maltodextrin-Gels stauen sich im Darm.`);
    }
  }

  // Packing list.
  const counts = new Map<string, number>();
  for (const it of slots.flatMap((s) => s.items)) counts.set(it.productId, (counts.get(it.productId) ?? 0) + it.count);
  const packing: PackingItem[] = [];
  if (drink && servings > 0) packing.push({ productId: drink.id, name: drink.name, count: servings, spare: 0, servingLabel: drink.servingLabel });
  for (const [id, count] of counts) {
    const p = pantry.find((x) => x.id === id)!;
    packing.push({ productId: id, name: p.name, count, spare: 0, servingLabel: p.servingLabel });
  }
  // Spare: one extra of the main carbohydrate product for long sessions.
  if (minutes >= 120 && packing.length) {
    const main = [...counts.entries()].filter(([id]) => pantry.find((p) => p.id === id)?.kind !== "salt").sort((a, b) => b[1] - a[1])[0];
    if (main) packing.find((p) => p.productId === main[0])!.spare = 1;
  }
  const waterMl = Math.max(Math.round(fluidTotal / 50) * 50, drink ? servings * drink.fluidMl! : 0);
  if (input.sport === "run" && waterMl > 750) {
    warnings.push(`Etwa ${formatNumber(waterMl / 1000, 1)} l Flüssigkeit: Softflasks, Trinkweste oder eine Runde mit Trinkstelle einplanen.`);
  } else if (fluidTotal > 0 && waterMl > 2000 && input.sport === "ride") {
    warnings.push(`Insgesamt etwa ${formatNumber(waterMl / 1000, 1)} l Flüssigkeit: plane einen Nachfüllstopp ein.`);
  }

  return { slots, totals, packing, waterMl, warnings };
}
