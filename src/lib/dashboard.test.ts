import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, layoutOf, sanitizeLayout, WIDGET_IDS, WIDGETS } from "./dashboard";

describe("dashboard layout", () => {
  it("uses the default until the athlete saves their own", () => {
    expect(layoutOf(null)).toBe(DEFAULT_LAYOUT);
    expect(layoutOf([])).toEqual([]);
    // Sleep and weight are opt-in: not everyone records them.
    expect(DEFAULT_LAYOUT.map((i) => i.id)).not.toContain("sleep");
    expect(DEFAULT_LAYOUT.map((i) => i.id)).not.toContain("weight");
    expect(sanitizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });

  it("drops unknown and duplicate widgets and fixes sizes and goals", () => {
    const layout = sanitizeLayout([
      { id: "hrv", size: "l" },
      { id: "nope", size: "m" },
      { id: "hrv", size: "s" },
      { id: "pmc", size: "s" },
      { id: "consistency", size: "m", goal: 99 },
      { id: "sleep", size: "m" },
      "garbage",
    ]);
    expect(layout).toEqual([
      { id: "hrv", size: "s" },
      { id: "pmc", size: "l" },
      { id: "consistency", size: "m", goal: 3 },
      { id: "sleep", size: "m" },
    ]);
    expect(sanitizeLayout("x")).toBe(DEFAULT_LAYOUT);
  });

  it("describes every widget", () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGETS[id].title).toBeTruthy();
      expect(WIDGETS[id].sizes.length).toBeGreaterThan(0);
    }
  });
});
