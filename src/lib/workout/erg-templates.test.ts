import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";
import { parseWorkoutText } from "./text";
import { ergCheck } from "./trainer";
import { DEFAULT_THRESHOLDS } from "./types";

describe("ride templates", () => {
  it("are ERG ready (power target on every step)", () => {
    const rides = TEMPLATES.filter((t) => t.sport === "ride");
    expect(rides.length).toBeGreaterThan(0);
    for (const t of rides) {
      const { structure } = parseWorkoutText(t.text, "ride", DEFAULT_THRESHOLDS);
      expect({ name: t.name, withoutPower: ergCheck(structure).withoutPower }).toEqual({ name: t.name, withoutPower: 0 });
    }
  });
});
