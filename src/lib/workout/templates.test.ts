import { describe, expect, it } from "vitest";
import { parseStructure } from "./schema";
import { TEMPLATES } from "./templates";
import { parseWorkoutText } from "./text";

const T = { ftp: 250, lthr: 170, maxHr: 190, thresholdPace: 300 };

describe("templates", () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.id} parses cleanly`, () => {
      const r = parseWorkoutText(tpl.text, tpl.sport, T);
      expect(r.errors).toEqual([]);
      expect(() => parseStructure(r.structure)).not.toThrow();
    });
  }
});
