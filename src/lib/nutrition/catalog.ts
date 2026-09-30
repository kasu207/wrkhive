import type { FuelProduct } from "./types";

/**
 * Generic base products with typical label values. Athletes add their own
 * branded products with the exact values from the pack.
 */
export const CATALOG: FuelProduct[] = [
  { id: "date", name: "Medjool-Dattel", kind: "fruit", carbsG: 18, sodiumMg: 0, caffeineMg: 0, multiSource: true, fluidMl: null, servingLabel: "1 Stück (24 g)" },
  { id: "banana", name: "Banane", kind: "fruit", carbsG: 27, sodiumMg: 0, caffeineMg: 0, multiSource: true, fluidMl: null, servingLabel: "1 mittelgroße" },
  { id: "bar", name: "Energieriegel", kind: "bar", carbsG: 40, sodiumMg: 50, caffeineMg: 0, multiSource: true, fluidMl: null, servingLabel: "1 Riegel" },
  { id: "rice-cake", name: "Reiskuchen (selbstgemacht)", kind: "snack", carbsG: 25, sodiumMg: 150, caffeineMg: 0, multiSource: false, fluidMl: null, servingLabel: "1 Stück" },
  { id: "pretzel", name: "Salzstangen", kind: "snack", carbsG: 22, sodiumMg: 450, caffeineMg: 0, multiSource: false, fluidMl: null, servingLabel: "1 Handvoll (30 g)" },
  { id: "gel", name: "Energie-Gel", kind: "gel", carbsG: 25, sodiumMg: 50, caffeineMg: 0, multiSource: false, fluidMl: null, servingLabel: "1 Beutel" },
  { id: "gel-dual", name: "Gel 2:1 (Glukose/Fruktose)", kind: "gel", carbsG: 40, sodiumMg: 50, caffeineMg: 0, multiSource: true, fluidMl: null, servingLabel: "1 Beutel" },
  { id: "gel-caffeine", name: "Koffein-Gel", kind: "gel", carbsG: 25, sodiumMg: 50, caffeineMg: 75, multiSource: false, fluidMl: null, servingLabel: "1 Beutel" },
  { id: "chews", name: "Chews / Fruchtgummi", kind: "chew", carbsG: 25, sodiumMg: 30, caffeineMg: 0, multiSource: true, fluidMl: null, servingLabel: "1 Portion" },
  { id: "drink-mix", name: "Getränkemix", kind: "drink", carbsG: 40, sodiumMg: 400, caffeineMg: 0, multiSource: true, fluidMl: 500, servingLabel: "40 g auf 500 ml" },
  { id: "drink-high", name: "High-Carb-Mix", kind: "drink", carbsG: 80, sodiumMg: 500, caffeineMg: 0, multiSource: true, fluidMl: 500, servingLabel: "80 g auf 500 ml" },
  { id: "cola", name: "Cola", kind: "drink", carbsG: 35, sodiumMg: 10, caffeineMg: 32, multiSource: true, fluidMl: 330, servingLabel: "330 ml" },
  { id: "salt-tab", name: "Salztablette", kind: "salt", carbsG: 0, sodiumMg: 250, caffeineMg: 0, multiSource: false, fluidMl: null, servingLabel: "1 Tablette" },
];

/** Pantry for athletes who have not chosen yet: the classics. */
export const DEFAULT_PANTRY = ["date", "banana", "bar", "gel", "gel-dual", "drink-mix", "salt-tab"];

export function catalogProduct(id: string): FuelProduct | undefined {
  return CATALOG.find((p) => p.id === id);
}
